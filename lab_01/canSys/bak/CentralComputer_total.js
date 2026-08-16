/**
 * CentralComputer.js — 中央监控计算机
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 页面列表：
 *   [0] 报警页面      — 报警列表、确认、消音
 *   [1] 参数显示页面  — AI / AO / DI / DO 实时值 (4块)
 *   [2] 网络诊断页面  — CAN 总线、节点状态、通信统计
 *   [3] AI 设置页面   — 通道模式、报警阈值、工程量
 *   [4] AO 设置页面   — 自动/手动切换、强制输出
 *   [5] DI 设置页面   — 自动/手动切换、滑块调整
 *   [6] DO 设置页面   — 计数、防抖、门限配置
 *   [7] 液位双位控制画面
 *   [8] 温度控制画面
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { CANId, CAN_FUNC, CANParser, NMT_CMD, NMT_STATE } from './CANBUS.js';

// ─────────────────────────────────────────────
//  尺寸常量
// ─────────────────────────────────────────────
const W = 680;
const H = 500;
const TAB_H = 60;   // 标签栏占用高度（含品牌条）
const BODY_Y = TAB_H + 2;
const BODY_H = H - BODY_Y - 8;

const TABS = ['监测报警', '参数一览', '网络诊断', 'AI设置', 'AO设置', 'DI设置', 'DO设置', '液位控制', '温度控制'];

// ── 配色系统 ──────────────────────────────────
const C = {
    bg: '#f5f5f5',
    panel: '#ffffff',
    border: '#d0d0d0',
    tab: '#e8e8e8',
    tabActive: '#ffffff',
    blue: '#0366d6',
    green: '#28a745',
    red: '#dc3545',
    yellow: '#ffc107',
    orange: '#fd7e14',
    purple: '#6f42c1',
    cyan: '#17a2b8',
    textDim: '#666666',
    text: '#333333',
    gridLine: '#e0e0e0',
};

// ─────────────────────────────────────────────
//  主类
// ─────────────────────────────────────────────
export class CentralComputer extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.w = W;
        this.h = H + 30;
        this.scale = 1.5;
        this.type = 'CentralComputer';
        this.cache = 'fixed';

        this.commFault = false;
        this.busConnected = false;

        // ── 当前页面 ── 当前激活的页面索引（用于多页面 HMI 切换）
        this.activePage = 1;

        // ── 系统数据快照 ──这是 HMI 显示的核心数据源，由 CAN 总线回调实时更新
        this.data = {
            ai: {
                // 每个通道的当前状态，显示值、单位、是否错误、错误代码、警报代码
                ch1: { value: 0, fault: false, faultText: 'normal', alarm: 'normal', unit: '%' },
                ch2: { value: 0, fault: false, faultText: 'normal', alarm: 'normal', unit: 'bar' },
                ch3: { value: 20, fault: false, faultText: 'normal', alarm: 'normal', unit: '°C' },
                ch4: { value: 20, fault: false, faultText: 'normal', alarm: 'normal', unit: '°C' },
            },
            ao: {
                ch1: { type: '4-20mA', percent: 0, actual: 4.0, fault: false, hold: false },
                ch2: { type: '4-20mA', percent: 0, actual: 4.0, fault: false, hold: false },
                ch3: { type: 'PWM', percent: 0, actual: 0, fault: false, hold: false },// 脉冲宽度调制
                ch4: { type: 'PWM', percent: 0, actual: 0, fault: false, hold: false },
            },
            di: {
                ch1: { state: false, fault: false, counter: 0 },// 包含状态、故障和计数值
                ch2: { state: false, fault: false, counter: 0 },
                ch3: { state: false, fault: false, counter: 0 },
                ch4: { state: false, fault: false, counter: 0 },
            },
            do: {
                ch1: { state: false, fault: false, hold: false },// 包含状态、故障和保持位
                ch2: { state: false, fault: false, hold: false },
                ch3: { state: false, fault: false, hold: false },
                ch4: { state: false, fault: false, hold: false },
            },
        };

        // ── DO 手动控制 ──
        this.doManual = { ch1: false, ch2: false, ch3: false, ch4: false };
        this.doManualState = { ch1: false, ch2: false, ch3: false, ch4: false };

        // ── AO 手动控制 ──
        this.aoManual = { ch1: false, ch2: false, ch3: false, ch4: false };
        this.aoManualVal = { ch1: 0, ch2: 0, ch3: 0, ch4: 0 };

        // ── 报警系统（参照 Monitor.js）──
        this.activeAlarms = [];
        this.alarmIdCounter = 0;
        this.flashState = true;
        this.faultTimers = {};
        this.alarmDelay = 3000;
        this.maxAlarmLines = 15;

        // ── 液位双位控制 ──
        this.levelCtrl = {
            level: 45, setHH: 80, setH: 70, setL: 30, setLL: 20,
            inletOn: false, drainOn: false, simMode: true,
        };
        this._levelTrendHistory = [];

        // ── 温度控制 ──
        this.tempCtrl = {
            pv: 25, sv: 60, out: 0, mode: 'AUTO',
            history: [], maxHist: 200,
        };

        // ── CAN 总线运行时状态 ──
        // nodeAddress：中央计算机挂载到总线的节点地址（0 号主站）
        this.nodeAddress = 0;
        // _canNodeLastSeen：记录各从站节点最近一次上报帧的时间戳，用于超时检测
        this._canNodeLastSeen = {};
        // _diPrevState：上一帧 DI 状态，用于上升沿计数
        this._diPrevState = {};

        // ── NMT 网络管理 ──
        // 记录各节点的NMT状态（nodeAddr → state）
        this.nmtNodeStates = {
            ai: 'init',   // AI模块NMT状态
            ao: 'init',   // AO模块NMT状态
            di: 'init',   // DI模块NMT状态
            do: 'init',   // DO模块NMT状态
        };
        // 节点配置存储（通过CAN读取参数并缓存）
        this.nodeConfigs = {
            // 存储各个通道、范围、警报参数
            ai: { channels: {}, ranges: {}, alarms: {}, lastupdated: 0 },
            ao: { channels: {}, lastupdated: 0 },
            di: { channels: {}, lastupdated: 0 },
            do: { channels: {}, lastupdated: 0 },
        };
        // 心跳发送控制：是否已为总线启动心跳广播
        this._heartbeatRunning = false;
        // 心跳间隔(ms)，可以通过 config 覆盖
        this.heartbeatIntervalMs = (config && config.heartbeatIntervalMs) ? config.heartbeatIntervalMs : 1000;
        // AI 参数加载状态：available 表示已从节点读取过参数，pending 表示等待节点上线后再读取
        this.nodeConfigs.ai.available = false;
        this.nodeConfigs.ai.pending = false;
        // NMT启动序列控制
        this.nmtStartSequence = null;  // 启动序列计时器
        this.nmtAutoStart = true;      // 是否自动启动所有节点
        this.nmtAutoStartDelay = 2000; // 2秒后自动启动

        this._initPorts();
        this._initVisuals();
        this._startLoop();
    }

    // ══════════════════════════════════════════
    //  界面初始化
    // ══════════════════════════════════════════
    _initVisuals() {
        this.sg = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.sg);

        this._drawShell();  //绘制外壳，包括主体外框、顶部蓝条、标题、时钟、底框和状态栏。
        this._drawTabs();   // 绘制切换表栏
        this._buildPages(); // 构建各个页面
    }

    _drawShell() {
        const sg = this.sg;

        // 主体外框
        sg.add(new Konva.Rect({
            width: W, height: H + 30,
            fill: '#ccdceb', stroke: '#30363d', strokeWidth: 3, cornerRadius: 6,
        }));

        // 顶部蓝条
        sg.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 6, fill: '#269d2a', cornerRadius: [6, 6, 0, 0] }));

        // 品牌 & 时钟
        sg.add(new Konva.Text({ x: 10, y: 10, text: '总线式船舶机舱监测报警系统', fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue, align: 'center' }));

        this._clockText = new Konva.Text({
            x: W - 115, y: 10, width: 105, text: '--:--:--',
            fontSize: 16, fontFamily: 'Courier New', fill: C.blue, align: 'right',
        });
        sg.add(this._clockText);

        // 屏幕底框
        sg.add(new Konva.Rect({
            x: 4, y: TAB_H - 2, width: W - 8, height: BODY_H + 8,
            fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 3,
        }));

        // 底部状态栏
        const barY = H + 4;
        sg.add(new Konva.Rect({ x: 0, y: barY, width: W, height: 26, fill: '#0d1117', stroke: C.border, strokeWidth: 1 }));
        this._statusText = new Konva.Text({ x: 10, y: barY + 8, text: '● CAN BUS ONLINE', fontSize: 11, fontFamily: 'Courier New', fill: C.green });
        this._alarmCountText = new Konva.Text({ x: 200, y: barY + 8, text: '报警: 无', fontSize: 11, fontFamily: 'Courier New', fill: C.green });
        this._nodeText = new Konva.Text({ x: 360, y: barY + 8, text: 'NODE: ------', fontSize: 11, fontFamily: 'Courier New', fill: C.green });
        sg.add(this._statusText, this._alarmCountText, this._nodeText);
    }

    // ── 标签栏 ───────────────────────────────
    _drawTabs() {
        // 1. 重置标签缓存数组
        // 每次重绘前清空，防止重复添加        
        this._tabs = [];
        // 2. 计算单个标签的宽度
        // (总宽度 W - 左右边距 8) / 标签数量
        // 确保所有标签平铺填满整个宽度       
        const tabW = (W - 8) / TABS.length;

        TABS.forEach((label, i) => {
            // A. 计算当前标签的 X 坐标
            // 左边距 4 + 索引 * 单个宽度            
            const x = 4 + i * tabW;
            // B. 创建背景矩形
            // 位于 y: 30 (标题栏下方)，高度 22
            // 圆角设置：仅顶部两个角圆角 [3, 3, 0, 0]，底部直角            
            const bg = new Konva.Rect({ x, y: 30, width: tabW - 1, height: 22, fill: C.tab, stroke: C.border, strokeWidth: 1, cornerRadius: [3, 3, 0, 0] });
            // C. 创建文本标签
            // 覆盖在背景之上，居中对齐            
            const txt = new Konva.Text({ x, y: 30, width: tabW - 1, height: 22, text: label, align: 'center', verticalAlign: 'middle', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            // D. 创建底部指示器
            // 位于 y: 50 (标签下方)，初始透明
            // 用于在选中时显示高亮线条            
            const ind = new Konva.Rect({ x: x + 3, y: 50, width: tabW - 7, height: 2, fill: 'transparent', cornerRadius: 1 });

            // E. 绑定交互事件
            // 同时监听鼠标点击 ('click') 和触摸 ('tap') 事件
            bg.on('click tap', () => this._switchPage(i));
            txt.on('click tap', () => this._switchPage(i));

            this.sg.add(bg, txt, ind);
            // F. 添加到图层和缓存列表            
            this._tabs.push({ bg, txt, ind });
        });

        this._refreshTabs();
    }

    _refreshTabs() {
        this._tabs.forEach((t, i) => {
            // 1. 判断当前标签是否被选中
            // 如果索引匹配 activePage，则为激活状态 (a = true)
            const a = i === this.activePage;
            t.bg.fill(a ? C.bg : C.tab); // 激活：使用背景色 C.bg (通常与页面背景融合，看起来像“连通”了)
            t.txt.fill(a ? C.blue : C.textDim); // 激活：使用高亮色 C.blue (醒目)
            t.txt.fontStyle(a ? 'bold' : 'normal');  // 激活：加粗 ('bold')
            t.txt.fontSize(a ? 13 : 12); // 激活：稍微放大 (13px)，增加视觉权重
            t.ind.fill(a ? C.blue : 'transparent'); // 激活：显示蓝色线条 (C.blue)
        });
    }

    _switchPage(idx) {
        // 1. 更新内部状态
        // 将当前活动页面的索引更新为目标索引
        this.activePage = idx;
        // 2. 切换页面可见性
        // 遍历所有页面容器,只有索引匹配的页面设为可见 (true)，其余隐藏 (false)        
        this._pages.forEach((p, i) => p.visible(i === idx));
        // 3. 刷新标签栏 UI
        // 调用 _refreshTabs() 更新顶部标签的高亮、颜色和字体样式
        // 让视觉反馈与当前页面保持一致
        this._refreshTabs();
        // 4. 刷新缓存层
        // 调用 _refreshCache() 重绘或更新底层 Canvas 缓存
        // 确保切换页面后，背景或静态元素能正确渲染
        this._refreshCache();
    }

    // ── 页面容器 ─────────────────────────────
    /**
 * 构建所有页面容器 
 * 初始化主界面所需的各个“标签页”容器。
 * 它为每个标签创建一个 Konva.Group 作为占位符，
 * 然后调用具体的构建方法来填充内容。
 */
    _buildPages() {
        // 1. 初始化页面数组
        // 用于存储所有页面的 Group 引用，方便后续切换可见性        
        this._pages = [];
        // 2. 创建基础容器
        // 遍历标签数量，为每个标签创建一个对应的 Group 容器
        for (let i = 0; i < TABS.length; i++) {
            const g = new Konva.Group({ x: 4, y: BODY_Y, visible: i === this.activePage });
            this.sg.add(g);
            this._pages.push(g);  // 保存到数组中，以便通过索引访问
        }
        this._buildAlarmPage();     // 0: 报警列表页
        this._buildParamPage();     // 1: 系统参数页
        this._buildNetworkPage();   // 2: 网络拓扑/状态页
        this._buildAISetPage();     // 3: AI 模拟量输入设置页
        this._buildAOPage();        // 4: DO 模拟量输出控制页
        this._buildDISetPage();     // 5: DI 数字量输入设置页
        this._buildDOPage();        // 6: DO 数字量输出控制页
        this._buildLevelPage();     // 7: 液位控制/监控页
        this._buildTempPage();      // 8: 温度控制/监控页
    }

    // ══════════════════════════════════════════
    //  PAGE 0 — 报警
    // ══════════════════════════════════════════
    _buildAlarmPage() {
        // 1. 获取页面容器和尺寸
        const pg = this._pages[0];
        const pw = W - 8, ph = BODY_H;
        // 2. 绘制背景面板
        // 圆角矩形，作为页面的视觉容器
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        // 3. 绘制页面标题
        // 使用 ■ 符号作为装饰，蓝色加粗显示
        pg.add(new Konva.Text({ x: 8, y: 2, text: '■ 报警列表', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

        // 4. 绘制列表表头
        // 显示列名：时间、状态、描述
        pg.add(new Konva.Text({ x: 8, y: 22, text: '时间        状态   描述', fontSize: 11, fontFamily: 'Courier New', fill: C.textDim }));
        // 表头下方的分隔线
        pg.add(new Konva.Line({ points: [6, 34, pw - 6, 34], stroke: C.border, strokeWidth: 1 }));

        // 5. 初始化报警行容器
        this._alarmLines = [];
        // 循环创建固定数量的文本行（最多 10 条）
        for (let i = 0; i < this.maxAlarmLines; i++) {
            const t = new Konva.Text({
                x: 8, y: 42 + i * 21, width: pw - 16, text: '',   // 初始为空，后续通过逻辑更新
                fontSize: 12, fontFamily: 'Courier New', fill: C.textDim,
            });
            pg.add(t);
            this._alarmLines.push(t);  // 保存引用以便后续更新文字内容
        }

        // 6. 绘制底部按钮区域分隔线
        const btnY = ph - 36;
        pg.add(new Konva.Line({ points: [6, btnY, pw - 6, btnY], stroke: C.border, strokeWidth: 1 }));

        // 7. 创建操作按钮
        // 使用辅助方法 _mkBtn 创建按钮
        this._btnAck = this._mkBtn(pg, '  确  认  ', 120, btnY + 10, C.green);
        this._btnMute = this._mkBtn(pg, '  消  音  ', 18, btnY + 10, C.yellow);
        this._btnClrHist = this._mkBtn(pg, '  清  除  ', 224, btnY + 10, C.textDim);
        // 8. 绑定按钮事件逻辑
        // A. 确认逻辑，// 如果报警已消失（非物理激活）且未被确认，则标记为已确认
        this._btnAck.on('click tap', () => { this.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; }); });
        // B. 消音逻辑，// 如果报警未确认，则标记为已消音、消闪
        this._btnMute.on('click tap', () => { this.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; }); });
        // C. 清除历史逻辑，从列表中移除所有已确认的报警记录
        this._btnClrHist.on('click tap', () => { this.activeAlarms = this.activeAlarms.filter(a => !a.confirmed); });
        // 9. 绘制报警状态指示灯
        // 位于右下角，用于直观显示系统是否有报警
        // 报警指示灯
        this._alarmLed = new Konva.Circle({ x: pw - 22, y: btnY + 12, radius: 10, fill: '#220000', stroke: C.border, strokeWidth: 1 });
        pg.add(this._alarmLed);
        // 指示灯标签
        pg.add(new Konva.Text({ x: pw - 35, y: btnY + 25, text: 'ALARM', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
    }

    // ══════════════════════════════════════════
    //  PAGE 1 — 参数显示（4块）
    // ══════════════════════════════════════════
    /**
 * 构建系统参数概览页面 (索引 1)
 * 
 * 创建一个 2x2 的网格布局，分别展示 AI、AO、DI、DO 四个模块的实时状态。
 * 每个模块包含标题、4 个通道的数值显示和可视化进度条。
 */
    _buildParamPage() {
        // 1. 初始化页面容器
        const pg = this._pages[1];
        const pw = W - 8, ph = BODY_H;
        // 添加背景面板
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        // 2. 计算网格尺寸
        // 将可用区域分为 2x2 的四个象限
        // bw: 块宽度 (Block Width), bh: 块高度 (Block Height)
        const bw = Math.floor((pw - 12) / 2);
        const bh = Math.floor((ph - 12) / 2);
        // 3. 定义模块配置
        // 包含模块键值、标题、坐标和主题颜色        
        const blocks = [
            { key: 'ai', title: 'AI  模拟量输入', x: 4, y: 4, color: C.blue },
            { key: 'ao', title: 'AO  模拟量输出', x: 4 + bw + 4, y: 4, color: C.orange },
            { key: 'di', title: 'DI  数字量输入', x: 4, y: 4 + bh + 4, color: C.green },
            { key: 'do_', title: 'DO  数字量输出', x: 4 + bw + 4, y: 4 + bh + 4, color: C.purple },// 右下 (注意 key 为 do_ 避免与 DO 变量冲突)
        ];
        // 4. 初始化显示缓存
        // 用于存储每个模块的文本和进度条引用，以便后续 update 循环更新
        this._paramDisplays = {};
        // 5. 遍历构建各个模块卡片
        blocks.forEach(b => {
            const g = new Konva.Group({ x: b.x, y: b.y });
            pg.add(g);

            // A. 绘制卡片外框
            // 边框颜色使用主题色的半透明版本 (color + '55')
            g.add(new Konva.Rect({ width: bw, height: bh, fill: C.bg, stroke: b.color + '55', strokeWidth: 1, cornerRadius: 3 }));
            // B. 绘制标题栏背景
            // 顶部 18px 高度，使用极淡的主题色背景 (color + '18')
            g.add(new Konva.Rect({ width: bw, height: 18, fill: b.color + '18', cornerRadius: [3, 3, 0, 0] }));
            // C. 绘制标题文字
            g.add(new Konva.Text({ x: 6, y: 5, text: b.title, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: b.color }));
            // D. 准备通道标签数据
            // 根据模块类型定义 4 个通道的具体描述
            const rows = []; // 存储当前模块的行元素引用
            const chLabels = {
                ai: ['CH1 4-20mA', 'CH2 4-20mA', 'CH3 RTD  ', 'CH4 TC   '],
                ao: ['CH1 4-20mA', 'CH2 4-20mA', 'CH3 PWM  ', 'CH4 PWM  '],
                di: ['CH1 干接点 ', 'CH2 干接点 ', 'CH3 湿接点', 'CH4 湿接点'],
                do_: ['CH1 继电器 ', 'CH2 继电器 ', 'CH3 24V NPN', 'CH4 24V NPN']
            };
            const lbls = chLabels[b.key];
            // 计算每行的高度，减去标题高度后平均分配给 4 行
            const rowH = Math.floor((bh - 22) / 4);
            // E. 循环构建 4 个通道的显示行
            for (let i = 0; i < 4; i++) {

                const ry = 26 + i * rowH;
                // 通道标签 (左侧)
                g.add(new Konva.Text({ x: 6, y: ry + 4, text: lbls[i], fontSize: 14, fontFamily: 'Courier New', fill: C.textDim }));
                // 数值显示 (右侧)
                // 初始文本为 '---'，右对齐
                const val = new Konva.Text({ x: bw - 90, y: ry + 4, width: 82, text: '---', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text, align: 'right' });
                // 进度条 (底部)
                // 初始宽度为 0，颜色为高透明度的主题色 (color + 'aa')                
                const bar = new Konva.Rect({ x: 6, y: ry + 20, width: 0, height: 3, fill: b.color + 'aa' });
                g.add(val, bar);
                // 保存引用以便后续刷新
                rows.push({ val, bar, maxBarW: bw - 14 });
            }
            // F. 将当前模块的行数据存入缓存对象
            this._paramDisplays[b.key] = rows;
        });
    }

    // ══════════════════════════════════════════
    //  PAGE 2 — 网络诊断
    // ══════════════════════════════════════════
    _buildNetworkPage() {
        const pg = this._pages[2];
        const pw = W - 8, ph = BODY_H;
        //整个面板，统一的颜色
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ CAN 网络诊断  (CANopen 250kbps)', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

        // ── 帧 ID 映射说明（CANBUS.js 编码规则）──
        const legend = [
            'ID=CANId.encode(funcCode,nodeAddr)  bit[10:7]=功能码  bit[6:0]=节点地址',
            'AI上报 ID=0x081  AO状态 ID=0x102  DI上报 ID=0x183   DO状态 ID=0x204',
            'AI配置 ID=0x081  AO指令 ID=0x102  DI配置 ID=0x183   DO指令 ID=0x204',
            '广播 func=0x0F node=0x00 ID=0x780',
        ];
        legend.forEach((t, i) => {
            pg.add(new Konva.Text({ x: 12, y: 26 + i * 20, text: t, fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
        });

        // ── 节点状态表 ───────────────────────────
        const tableY = 120;
        pg.add(new Konva.Line({ points: [6, tableY - 4, pw - 6, tableY - 4], stroke: C.border, strokeWidth: 1 }));
        pg.add(new Konva.Text({ x: 8, y: tableY + 2, text: '节点', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
        pg.add(new Konva.Text({ x: 170, y: tableY + 2, text: 'NMT状态', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
        pg.add(new Konva.Text({ x: 310, y: tableY + 2, text: '最近心跳', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
        pg.add(new Konva.Line({ points: [6, tableY + 18, pw - 6, tableY + 14], stroke: C.border, strokeWidth: 1 }));

        const nodes = [
            { id: 1, label: 'AI Module  addr=1', color: C.blue },
            { id: 2, label: 'AO Module  addr=2', color: C.orange },
            { id: 3, label: 'DI Module  addr=3', color: C.green },
            { id: 4, label: 'DO Module  addr=4', color: C.purple },
        ];

        this._netRowDisps = {};
        nodes.forEach((n, i) => {
            const ry = tableY + 24 + i * 28;
            pg.add(new Konva.Rect({ x: 6, y: ry - 2, width: pw - 12, height: 22, fill: C.bg, cornerRadius: 2 }));

            // 在线指示灯
            const dot = new Konva.Circle({ x: 20, y: ry + 7, radius: 5, fill: C.textDim, stroke: C.border, strokeWidth: 1 });
            pg.add(dot);

            // 节点标签
            pg.add(new Konva.Text({ x: 32, y: ry + 2, text: n.label, fontSize: 12, fontFamily: 'Courier New', fill: n.color }));

            // NMT 状态
            const status = new Konva.Text({ x: 170, y: ry + 2, text: 'NO HEARTBEAT', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            pg.add(status);

            // 心跳时效
            const age = new Konva.Text({ x: 310, y: ry + 2, text: '---', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            pg.add(age);

            this._netRowDisps[n.id] = { dot, status, age };
        });

        // ── 总线调试（来自 bus.getStats()）───────
        const debugY = tableY + 24 + nodes.length * 28;
        pg.add(new Konva.Line({ points: [6, debugY, pw - 6, debugY], stroke: C.border, strokeWidth: 1 }));
        // NMT 控制按钮（调用 bus.sendNMT）
        const btnY = debugY + 10;
        const nmtStart = this._mkBtn(pg, 'NMT: 启动全部节点', 8, btnY, C.green);
        nmtStart.on('click tap', () => this._canSendNMT(0x01, 0));

        const nmtStop = this._mkBtn(pg, 'NMT: 停止全部节点', 110, btnY, C.yellow);
        nmtStop.on('click tap', () => this._canSendNMT(0x02, 0));

        const nmtReset = this._mkBtn(pg, 'NMT: 复位应用', 212, btnY, C.red);
        nmtReset.on('click tap', () => this._canSendNMT(0x81, 0));
        // ── 总线统计（来自 bus.getStats()）───────        
        const statsY = debugY + 130;
        pg.add(new Konva.Line({ points: [6, statsY, pw - 6, statsY], stroke: C.border, strokeWidth: 1 }));
        pg.add(new Konva.Text({ x: 8, y: statsY + 6, text: '■ 总线统计', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));
        this._netStatsText = new Konva.Text({ x: 8, y: statsY + 24, text: 'TX:0  RX:0  ERR:0  LOAD:0.0%  BUS-OFF:否', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(this._netStatsText);
        pg.add(new Konva.Line({ points: [6, statsY + 45, pw - 6, statsY + 45], stroke: C.border, strokeWidth: 1 }));


    }

    // ══════════════════════════════════════════
    //  PAGE 3 — AI 设置
    // ══════════════════════════════════════════
    _buildAISetPage() {
        const pg = this._pages[3];
        const pw = W - 8, ph = BODY_H;
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ AI 模拟量输入设置', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

        const chDefs = [
            { id: 'ch1', label: 'CH1', type: '4-20mA 压力', range: '0~1.0 MPa' },
            { id: 'ch2', label: 'CH2', type: '4-20mA 压力', range: '0~1.0 MPa' },
            { id: 'ch3', label: 'CH3', type: 'PT100 温度', range: '-50~200°C' },
            { id: 'ch4', label: 'CH4', type: 'TC 温度', range: '0~400°C' },
        ];

        this._aiRows = {};
        // const unitOptions = ['%', 'MPa', 'bar', '°C', 'cm', 'L/min'];

        chDefs.forEach((ch, i) => {
            const y = 32 + i * 100;
            pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 94, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));

            // 通道标题与量程
            pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label + ' ' + ch.type, fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

            // 模式（三态：normal / disable / test）
            const modeGrp = new Konva.Group({ x: 234, y: y });
            const modeBg = new Konva.Rect({ width: 100, height: 20, fill: '#e2e6f4', stroke: C.border, strokeWidth: 1, cornerRadius: 4 });
            const modeTxt = new Konva.Text({ width: 100, height: 20, text: 'mode: --', align: 'center', verticalAlign: 'middle', fontSize: 11, fontFamily: 'Courier New', fill: C.textDim });
            modeGrp.add(modeBg, modeTxt);
            pg.add(modeGrp);
            modeGrp.on('click tap', () => {
                // 通过 CAN 发送模式设置命令 (0x05)
                const ai = this.sys.comps['ai'];
                if (!ai || !this.sys || !this.sys.canBus) return;
                const cur = (ai.channels && ai.channels[ch.id] && ai.channels[ch.id].mode) || 'normal';
                const seq = ['normal', 'disable', 'test'];
                const ni = (seq.indexOf(cur) + 1) % seq.length;
                const next = seq[ni];
                const modeMap = { normal: 0, test: 1, disable: 2 };
                const chIdx = i; // 0-3
                const modeVal = modeMap[next] || 0;
                const addr = 1;
                const data = [0x05, chIdx & 0xFF, modeVal & 0xFF, 0, 0, 0, 0, 0];

                // 乐观更新 UI：立即显示新模式并更新缓存
                try {
                    if (!this.data.ai[ch.id]) this.data.ai[ch.id] = {};
                    this.data.ai[ch.id].mode = next;
                    if (ai.channels && ai.channels[ch.id]) ai.channels[ch.id].mode = next;
                    if (modeTxt) {
                        modeTxt.text(`Mode: ${next}`);
                        if (next === 'normal') modeTxt.fill(C.green);
                        else if (next === 'test') modeTxt.fill(C.orange);
                        else modeTxt.fill(C.textDim);
                    }
                    this._updateAIRowFromModule(ch.id);
                } catch (e) { console.warn('optimistic UI update failed', e); }

                try {
                    this.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, addr), extended: false, rtr: false, dlc: 8, data, sender: this.id, timestamp: Date.now() });
                    // 请求更新状态以保证最终一致性
                    setTimeout(() => this._requestNodeConfig('ai', 0x0A, 0), 60);
                } catch (e) { console.warn(e); }
            });

            // 工程量显示；在 test 模式下允许写入
            pg.add(new Konva.Text({ x: 14, y: y + 71, text: '工程量:', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
            const valDisplay = new Konva.Text({ x: 124, y: y + 71, width: 100, text: '---', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green, align: 'left' });
            pg.add(valDisplay);

            // 上下限与单位（点击可编辑）
            const urvText = new Konva.Text({ x: 14, y: y + 51, text: '上限: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            const lrvText = new Konva.Text({ x: 124, y: y + 51, text: '下限: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            const unitText = new Konva.Text({ x: 234, y: y + 51, text: '单位: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            pg.add(urvText, lrvText, unitText);

            // 报警阈值显示（HH, H, L, LL）
            const hhText = new Konva.Text({ x: 14, y: y + 31, text: 'HH: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            const hText = new Konva.Text({ x: 124, y: y + 31, text: 'H: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            const lText = new Konva.Text({ x: 234, y: y + 31, text: 'L: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            const llText = new Konva.Text({ x: 344, y: y + 31, text: 'LL: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
            pg.add(hhText, hText, lText, llText);

            // 绑定编辑交互：点击上下限或单位打开编辑模态
            urvText.on('click tap', () => this._openRangeEditor(ch.id, { urvText, lrvText, unitText }));
            lrvText.on('click tap', () => this._openRangeEditor(ch.id, { urvText, lrvText, unitText }));
            unitText.on('click tap', () => this._openRangeEditor(ch.id, { urvText, lrvText, unitText }));

            // 点击工程量，在 test 模式下写入
            valDisplay.on('click tap', () => {
                const ai = this.sys.comps['ai'];
                if (!ai || !this.sys || !this.sys.canBus) return;
                const chMode = (ai.channels && ai.channels[ch.id] && ai.channels[ch.id].mode) || 'normal';
                if (chMode !== 'test') return; // 仅 test 模式允许写入
                const cur = ai.channels[ch.id] ? ai.channels[ch.id].value : 0;
                const v = prompt(`设置 ${ch.label} 测试工程量（当前 ${cur}）:`, String(cur));
                if (v === null) return;
                const num = parseFloat(v);
                if (isNaN(num)) return alert('请输入有效数字');
                // 通过 CAN 发送 0x06 设置工程量（×100，有符号16位）
                const chIdx = i;
                let raw = Math.round(num * 100);
                if (raw < 0) raw = (raw + 0x10000) & 0xFFFF;
                const hi = (raw >> 8) & 0xFF;
                const lo = raw & 0xFF;
                const addr = 1;
                const data = [0x06, chIdx & 0xFF, hi, lo, 0, 0, 0, 0];
                try {
                    this.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, addr), extended: false, rtr: false, dlc: 8, data, sender: this.id, timestamp: Date.now() });
                    // 请求通道值刷新
                    setTimeout(() => this._requestNodeConfig('ai', 0x09, chIdx), 60);
                } catch (e) { console.warn(e); }
            });

            // 点击报警阈值编辑
            hhText.on('click tap', () => this._openAlarmEditor(ch.id));
            hText.on('click tap', () => this._openAlarmEditor(ch.id));
            lText.on('click tap', () => this._openAlarmEditor(ch.id));
            llText.on('click tap', () => this._openAlarmEditor(ch.id));

            // 存储行元素引用
            this._aiRows[ch.id] = { modeGrp, modeBg, modeTxt, valDisplay, urvText, lrvText, unitText, hhText, hText, lText, llText };
        });

        // 通过 CAN 向 AI 模块查询初始化参数（通过 CAN 命令获取，而不是直接读取模块内存）
        setTimeout(() => {
            try {
                const bus = this.sys?.canBus;
                const aiOnline = bus ? bus.isNodeOnline('ai') : false;
                if (aiOnline && this.busConnected && !this.commFault) {
                    this.nodeConfigs.ai.available = true;
                    this.nodeConfigs.ai.pending = false;
                    this._initAIParams();
                } else {
                    this.nodeConfigs.ai.available = false;
                    this.nodeConfigs.ai.pending = true;
                }
            } catch (e) { console.warn(e); }
        }, 200);
    }

    // 发起对 AI 模块的参数查询（通过 CAN 命令）
    _initAIParams() {
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        chKeys.forEach((chId, idx) => {
            // 请求量程与单位（0x09）
            this._requestNodeConfig('ai', 0x09, idx);
            // 请求 HH/LL（0x07）与 H/L（0x08），带小延迟避免突发
            setTimeout(() => this._requestNodeConfig('ai', 0x07, idx), 40 + idx * 10);
            setTimeout(() => this._requestNodeConfig('ai', 0x08, idx), 80 + idx * 10);
        });
        // 请求总体报警/故障摘要（0x0A）
        setTimeout(() => this._requestNodeConfig('ai', 0x0A, 0), 300);
    }

    // ══════════════════════════════════════════
    //  PAGE 4 — AO 设置
    // ══════════════════════════════════════════
    _buildAOPage() {
        const pg = this._pages[4];
        const pw = W - 8, ph = BODY_H;
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ AO 模拟量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

        const chDefs = [
            { id: 'ch1', label: 'CH1', type: '4-20mA' },
            { id: 'ch2', label: 'CH2', type: '4-20mA' },
            { id: 'ch3', label: 'CH3', type: 'PWM' },
            { id: 'ch4', label: 'CH4', type: 'PWM' },
        ];

        this._aoRows = {};
        const sliderTrackW = pw - 80;

        chDefs.forEach((ch, i) => {
            const y = 24 + i * 70;
            pg.add(new Konva.Rect({ x: 6, y: y, width: pw - 12, height: 64, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));

            // 标签
            pg.add(new Konva.Text({ x: 14, y: y + 6, text: `${ch.label}  [${ch.type}]`, fontSize: 10, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

            // 当前值
            const curVal = new Konva.Text({ x: 14, y: y + 22, text: '0.0%  /  4.00mA', fontSize: 9, fontFamily: 'Courier New', fill: C.text });
            pg.add(curVal);

            // 模式切换
            const modeBtn = this._mkToggle(pg, '自  动', pw - 100, y + 4, 80, 22, false, C.green);
            modeBtn.on('click tap', () => {
                this.aoManual[ch.id] = !this.aoManual[ch.id];
                const isM = this.aoManual[ch.id];
                modeBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
                modeBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
                modeBtn.findOne('Text').text(isM ? '手  动' : '自  动');
                modeBtn.findOne('Text').fill(isM ? C.yellow : C.green);
                sliderGrp.opacity(isM ? 1 : 0.3);
                this._refreshCache();
            });

            // 滑块组
            const sliderGrp = new Konva.Group({ x: 14, y: y + 44, opacity: 0.3 });
            const trackRect = new Konva.Rect({ width: sliderTrackW, height: 6, fill: C.gridLine, stroke: C.border, strokeWidth: 1, cornerRadius: 3 });
            const fillRect = new Konva.Rect({ width: 0, height: 6, fill: C.orange, cornerRadius: 3 });
            const thumb = new Konva.Circle({ x: 0, y: 3, radius: 7, fill: C.orange, stroke: C.bg, strokeWidth: 2 });
            const valLabel = new Konva.Text({ x: sliderTrackW + 10, y: -2, text: '0%', fontSize: 10, fontFamily: 'Courier New', fill: C.orange });

            sliderGrp.add(trackRect, fillRect, thumb, valLabel);
            pg.add(sliderGrp);

            // 滑块拖拽
            thumb.draggable(true);
            thumb.dragBoundFunc(pos => {
                const absGroupX = sliderGrp.getAbsolutePosition().x;
                const localX = pos.x - absGroupX;
                const clamped = Math.max(0, Math.min(sliderTrackW, localX));
                return { x: clamped + absGroupX, y: thumb.getAbsolutePosition().y };
            });

            const applyVal = (clamped) => {
                const pct = Math.round((clamped / sliderTrackW) * 100);
                this.aoManualVal[ch.id] = pct;
                thumb.x(clamped);
                fillRect.width(clamped);
                valLabel.text(`${pct}%`);
                try { this.sys.getModule('AO').setOutput(ch.id, pct); } catch (_) { }
                this._refreshCache();
            };

            thumb.on('dragmove', () => {
                if (!this.aoManual[ch.id]) return;
                applyVal(thumb.x());
            });

            trackRect.on('click tap', (e) => {
                if (!this.aoManual[ch.id]) return;
                const absX = sliderGrp.getAbsolutePosition().x;
                const localX = e.evt.clientX - absX;
                applyVal(Math.max(0, Math.min(sliderTrackW, localX)));
            });

            this._aoRows[ch.id] = { curVal, modeBtn, sliderGrp, fillRect, thumb, valLabel };
        });
    }
    // ══════════════════════════════════════════
    //  PAGE 5 — DI 设置
    // ══════════════════════════════════════════
    _buildDISetPage() {
        const pg = this._pages[5];
        const pw = W - 8, ph = BODY_H;
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DI 数字量输入设置', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green }));

        // 表头
        ['通道', '类型', '当前状态', '计数器', '防抖时间', '动作'].forEach((h, i) => {
            pg.add(new Konva.Text({ x: [8, 72, 148, 240, 340, 420][i], y: 28, text: h, fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));
        });
        pg.add(new Konva.Line({ points: [6, 40, pw - 6, 40], stroke: C.border, strokeWidth: 1 }));

        const chDefs = [
            { id: 'ch1', label: 'CH1', type: '干接点' },
            { id: 'ch2', label: 'CH2', type: '干接点' },
            { id: 'ch3', label: 'CH3', type: '湿接点' },
            { id: 'ch4', label: 'CH4', type: '湿接点' },
        ];

        this._diRows = {};
        chDefs.forEach((ch, i) => {
            const y = 48 + i * 58;
            pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 52, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));

            pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
            pg.add(new Konva.Text({ x: 72, y: y + 4, text: ch.type, fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

            // 状态指示
            const stateDisp = new Konva.Text({ x: 148, y: y + 4, text: 'OFF', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim });
            pg.add(stateDisp);

            // 计数器
            const counterDisp = new Konva.Text({ x: 240, y: y + 4, text: '0', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan });
            pg.add(counterDisp);

            // 防抖
            pg.add(new Konva.Text({ x: 340, y: y + 4, text: '20ms', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

            // 复位按钮
            const resetBtn = this._mkBtn(pg, '复位', 420, y + 4, C.orange);
            resetBtn.on('click tap', () => {
                counterDisp.text('0');
            });

            this._diRows[ch.id] = { stateDisp, counterDisp };
        });
    }

    // ══════════════════════════════════════════
    //  PAGE 6 — DO 设置
    // ══════════════════════════════════════════
    _buildDOPage() {
        const pg = this._pages[6];
        const pw = W - 8, ph = BODY_H;
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DO 数字量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.purple }));

        // 表头
        ['通道', '类型', '当前状态', '控制模式', '手动强制'].forEach((h, i) => {
            pg.add(new Konva.Text({ x: [8, 72, 148, 258, 370][i], y: 22, text: h, fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
        });
        pg.add(new Konva.Line({ points: [6, 34, pw - 6, 34], stroke: C.border, strokeWidth: 1 }));

        const chDefs = [
            { id: 'ch1', label: 'CH1', type: 'RELAY' },
            { id: 'ch2', label: 'CH2', type: 'RELAY' },
            { id: 'ch3', label: 'CH3', type: '24V' },
            { id: 'ch4', label: 'CH4', type: '24V' },
        ];

        this._doRows = {};
        chDefs.forEach((ch, i) => {
            const y = 40 + i * 54;
            pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 48, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
            pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label, fontSize: 10, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
            pg.add(new Konva.Text({ x: 72, y: y + 4, text: ch.type, fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));

            // 状态大字
            const stateDisp = new Konva.Text({ x: 148, y: y + 2, width: 90, text: 'OFF', fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim });
            pg.add(stateDisp);

            // 自动/手动切换
            const modeBtn = this._mkToggle(pg, '自  动', 258, y + 2, 78, 22, false, C.green);
            modeBtn.on('click tap', () => {
                this.doManual[ch.id] = !this.doManual[ch.id];
                const isM = this.doManual[ch.id];
                modeBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
                modeBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
                modeBtn.findOne('Text').text(isM ? '手  动' : '自  动');
                modeBtn.findOne('Text').fill(isM ? C.yellow : C.green);
                forceBtn.opacity(isM ? 1 : 0.35);
                this._refreshCache();
            });

            // 强制输出
            const forceBtn = this._mkToggle(pg, '强制 OFF', 370, y + 2, 90, 22, false, C.textDim);
            forceBtn.opacity(0.35);
            forceBtn.on('click tap', () => {
                if (!this.doManual[ch.id]) return;
                this.doManualState[ch.id] = !this.doManualState[ch.id];
                const on = this.doManualState[ch.id];
                forceBtn.findOne('Rect').fill(on ? C.red + '33' : C.textDim + '22');
                forceBtn.findOne('Rect').stroke(on ? C.red : C.textDim);
                forceBtn.findOne('Text').text(on ? '强制  ON ' : '强制 OFF');
                forceBtn.findOne('Text').fill(on ? C.red : C.textDim);
                try { this.sys.getModule('DO').setOutput(ch.id, on); } catch (_) { }
                this._refreshCache();
            });

            // 附加信息
            const infoText = new Konva.Text({ x: 148, y: y + 28, text: '', fontSize: 8, fontFamily: 'Courier New', fill: C.textDim });
            pg.add(infoText);

            this._doRows[ch.id] = { stateDisp, modeBtn, forceBtn, infoText };
        });
    }

    // ══════════════════════════════════════════
    //  PAGE 7 — 液位控制
    // ══════════════════════════════════════════
    _buildLevelPage() {
        const pg = this._pages[7];
        const pw = W - 8, ph = BODY_H;
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 液位双位控制系统', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

        // ── 储罐 ──
        const tkX = 50, tkY = 26, tkW = 100, tkH = 210;
        pg.add(new Konva.Rect({ x: tkX, y: tkY, width: tkW, height: tkH, fill: '#050e18', stroke: C.cyan + '66', strokeWidth: 2, cornerRadius: 4 }));

        // 液位填充
        this._lvFill = new Konva.Rect({ x: tkX + 2, y: tkY + tkH - 2, width: tkW - 4, height: 0, fill: C.cyan + '77', cornerRadius: [0, 0, 3, 3] });
        pg.add(this._lvFill);

        // 刻度线
        [{ l: 'HH', p: 0.80, c: C.red }, { l: 'H', p: 0.70, c: C.yellow }, { l: 'L', p: 0.30, c: C.yellow }, { l: 'LL', p: 0.20, c: C.red }].forEach(s => {
            const ly = tkY + tkH * (1 - s.p);
            pg.add(new Konva.Line({ points: [tkX - 6, ly, tkX + tkW + 6, ly], stroke: s.c, strokeWidth: 1, dash: [4, 3] }));
            pg.add(new Konva.Text({ x: tkX + tkW + 8, y: ly - 5, text: s.l, fontSize: 8, fontFamily: 'Courier New', fill: s.c }));
        });

        // 液位数值
        this._lvText = new Konva.Text({ x: tkX, y: tkY + tkH + 6, width: tkW, text: '45.0%', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan, align: 'center' });
        pg.add(this._lvText);

        // ── 管道 & 阀 ──
        // 进水（左上）
        pg.add(new Konva.Rect({ x: tkX - 36, y: tkY + 18, width: 36, height: 12, fill: '#081520', stroke: C.blue + '66', strokeWidth: 1 }));
        this._inletFlowBar = new Konva.Rect({ x: tkX - 34, y: tkY + 20, width: 0, height: 8, fill: C.blue + '88' });
        pg.add(this._inletFlowBar);
        pg.add(new Konva.Text({ x: tkX - 50, y: tkY + 8, text: '进水', fontSize: 8, fontFamily: 'Courier New', fill: C.blue }));

        // 排水（右下）
        pg.add(new Konva.Rect({ x: tkX + tkW, y: tkY + tkH - 36, width: 36, height: 12, fill: '#081520', stroke: C.orange + '66', strokeWidth: 1 }));
        this._drainFlowBar = new Konva.Rect({ x: tkX + tkW + 2, y: tkY + tkH - 34, width: 0, height: 8, fill: C.orange + '88' });
        pg.add(this._drainFlowBar);
        pg.add(new Konva.Text({ x: tkX + tkW + 2, y: tkY + tkH - 48, text: '排水', fontSize: 8, fontFamily: 'Courier New', fill: C.orange }));

        // ── 右侧控制面板 ──
        const cx = 185;
        pg.add(new Konva.Text({ x: cx, y: 22, text: '■ 控制参数', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

        const lvParams = [
            { label: 'HH报警', key: 'setHH', color: C.red },
            { label: 'H  上限', key: 'setH', color: C.yellow },
            { label: 'L  下限', key: 'setL', color: C.yellow },
            { label: 'LL报警', key: 'setLL', color: C.red },
        ];
        this._lvParamTexts = {};
        lvParams.forEach((p, i) => {
            const py = 38 + i * 24;
            pg.add(new Konva.Text({ x: cx, y: py, text: p.label + ' :', fontSize: 9, fontFamily: 'Courier New', fill: p.color }));
            const vt = new Konva.Text({ x: cx + 80, y: py, text: `${this.levelCtrl[p.key]}%`, fontSize: 9, fontFamily: 'Courier New', fill: C.text });
            pg.add(vt);
            this._lvParamTexts[p.key] = vt;
        });

        pg.add(new Konva.Text({ x: cx, y: 140, text: '■ 执行机构', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
        this._pumpText = new Konva.Text({ x: cx, y: 156, text: '进水阀:  OFF ○', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim });
        this._drainText = new Konva.Text({ x: cx, y: 174, text: '排水泵:  OFF ○', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(this._pumpText, this._drainText);

        this._lvAlarmText = new Konva.Text({ x: cx, y: 198, text: '● 液位正常', fontSize: 10, fontFamily: 'Courier New', fill: C.green });
        pg.add(this._lvAlarmText);

        // 仿真控制按钮
        this._simBtn = this._mkBtn(pg, '仿真:运行', cx, 222, C.cyan);
        this._simBtn.on('click tap', () => {
            this.levelCtrl.simMode = !this.levelCtrl.simMode;
            const r = this.levelCtrl.simMode;
            this._simBtn.findOne('Rect').fill(r ? C.cyan + '33' : C.textDim + '22');
            this._simBtn.findOne('Rect').stroke(r ? C.cyan : C.textDim);
            this._simBtn.findOne('Text').text(r ? '仿真:运行' : '仿真:停止');
            this._simBtn.findOne('Text').fill(r ? C.cyan : C.textDim);
        });

        const manInBtn = this._mkBtn(pg, '进水:强制', cx + 115, 222, C.blue);
        manInBtn.on('click tap', () => { this.levelCtrl.inletOn = !this.levelCtrl.inletOn; });
        const manDrBtn = this._mkBtn(pg, '排水:强制', cx + 230, 222, C.orange);
        manDrBtn.on('click tap', () => { this.levelCtrl.drainOn = !this.levelCtrl.drainOn; });

        // 液位趋势
        const trX = cx, trY = 252, trW = 350, trH = 50;
        pg.add(new Konva.Rect({ x: trX, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: trX + 3, y: trY + 2, text: 'LEVEL TREND', fontSize: 7, fontFamily: 'Courier New', fill: C.textDim }));
        this._lvTrendLine = new Konva.Line({ stroke: C.cyan, strokeWidth: 1.5 });
        pg.add(this._lvTrendLine);
        this._lvTrendMeta = { x: trX, y: trY, w: trW, h: trH };
    }

    // ══════════════════════════════════════════
    //  PAGE 8 — 温度控制
    // ══════════════════════════════════════════
    _buildTempPage() {
        const pg = this._pages[8];
        const pw = W - 8, ph = BODY_H;
        pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
        pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 温度控制系统', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.red }));

        // ── 温度计 ──
        const thX = 28, thY = 24, thW = 36, thH = 210;
        pg.add(new Konva.Rect({ x: thX, y: thY, width: thW, height: thH, fill: '#0a0808', stroke: C.red + '55', strokeWidth: 1, cornerRadius: 4 }));
        this._thermFill = new Konva.Rect({ x: thX + 3, y: thY + thH - 3, width: thW - 6, height: 0, fill: C.red + '99', cornerRadius: [0, 0, 2, 2] });
        pg.add(this._thermFill);

        // 刻度
        for (let t = 0; t <= 120; t += 20) {
            const gy = thY + thH - 2 - (t / 120) * (thH - 4);
            pg.add(new Konva.Line({ points: [thX - 4, gy, thX, gy], stroke: C.textDim, strokeWidth: 1 }));
            pg.add(new Konva.Text({ x: thX - 28, y: gy - 4, text: `${t}°`, fontSize: 7, fontFamily: 'Courier New', fill: C.textDim }));
        }
        this._pvLabel = new Konva.Text({ x: thX, y: thY + thH + 5, width: thW, text: '25°C', fontSize: 8, fontFamily: 'Courier New', fill: C.red, align: 'center' });
        pg.add(this._pvLabel);

        // ── PID 状态区 ──
        const px = 92;
        pg.add(new Konva.Text({ x: px, y: 22, text: '■ PID 运行状态', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.red }));

        const rows = [
            { label: 'PV 测量值', key: 'pv', color: C.red },
            { label: 'SV 设定值', key: 'sv', color: C.green },
            { label: 'OUT 输出', key: 'out', color: C.yellow },
        ];
        this._tempDisp = {};
        rows.forEach((r, i) => {
            const ry = 38 + i * 28;
            pg.add(new Konva.Text({ x: px, y: ry, text: r.label + ' :', fontSize: 9, fontFamily: 'Courier New', fill: r.color }));
            const vt = new Konva.Text({ x: px + 120, y: ry - 2, text: '---', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: r.color });
            pg.add(vt);
            this._tempDisp[r.key] = vt;
        });

        // 模式
        pg.add(new Konva.Text({ x: px, y: 128, text: '控制模式 :', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
        this._tempModeText = new Konva.Text({ x: px + 84, y: 128, text: 'AUTO', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green });
        pg.add(this._tempModeText);

        const amBtn = this._mkToggle(pg, '自  动', px + 130, 124, 76, 20, false, C.green);
        amBtn.on('click tap', () => {
            this.tempCtrl.mode = this.tempCtrl.mode === 'AUTO' ? 'MAN' : 'AUTO';
            const isM = this.tempCtrl.mode === 'MAN';
            amBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
            amBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
            amBtn.findOne('Text').text(isM ? '手  动' : '自  动');
            amBtn.findOne('Text').fill(isM ? C.yellow : C.green);
            this._tempModeText.text(this.tempCtrl.mode);
            this._tempModeText.fill(isM ? C.yellow : C.green);
            this._refreshCache();
        });

        // SV 调节
        pg.add(new Konva.Text({ x: px, y: 154, text: 'SV 调节 :', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
        const svUp = this._mkBtn(pg, '▲+5', px + 78, 150, C.green);
        const svDn = this._mkBtn(pg, '▼-5', px + 130, 150, C.red);
        svUp.on('click tap', () => { this.tempCtrl.sv = Math.min(150, this.tempCtrl.sv + 5); });
        svDn.on('click tap', () => { this.tempCtrl.sv = Math.max(0, this.tempCtrl.sv - 5); });

        // 加热器 & 冷却器图标
        pg.add(new Konva.Text({ x: px, y: 182, text: '加热器', fontSize: 8, fontFamily: 'Courier New', fill: C.textDim }));
        this._heaterBox = new Konva.Rect({ x: px, y: 194, width: 64, height: 20, fill: '#1a0000', stroke: C.red, strokeWidth: 1, cornerRadius: 2 });
        this._heaterTxt = new Konva.Text({ x: px, y: 194, width: 64, height: 20, text: 'OFF', align: 'center', verticalAlign: 'middle', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(new Konva.Text({ x: px + 78, y: 182, text: '冷却器', fontSize: 8, fontFamily: 'Courier New', fill: C.textDim }));
        this._coolerBox = new Konva.Rect({ x: px + 78, y: 194, width: 64, height: 20, fill: '#001020', stroke: C.blue, strokeWidth: 1, cornerRadius: 2 });
        this._coolerTxt = new Konva.Text({ x: px + 78, y: 194, width: 64, height: 20, text: 'OFF', align: 'center', verticalAlign: 'middle', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(this._heaterBox, this._heaterTxt, this._coolerBox, this._coolerTxt);

        // ── 趋势图 ──
        const trY = 226, trW = pw - 16, trH = ph - trY - 8;
        pg.add(new Konva.Rect({ x: 6, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 10, y: trY + 2, text: 'PV ─   SV - -   OUT ···', fontSize: 7, fontFamily: 'Courier New', fill: C.textDim }));
        [0.25, 0.5, 0.75].forEach(f => {
            const gy = trY + trH * (1 - f);
            pg.add(new Konva.Line({ points: [6, gy, 6 + trW, gy], stroke: C.gridLine, strokeWidth: 1 }));
        });
        this._tPV = new Konva.Line({ stroke: C.red, strokeWidth: 1.5 });
        this._tSV = new Konva.Line({ stroke: C.green, strokeWidth: 1.5, dash: [6, 4] });
        this._tOUT = new Konva.Line({ stroke: C.yellow, strokeWidth: 1, dash: [2, 2] });
        pg.add(this._tPV, this._tSV, this._tOUT);
        this._tempTrendMeta = { x: 6, y: trY, w: trW, h: trH };
    }

    // ══════════════════════════════════════════
    //  端口注册
    // ══════════════════════════════════════════
    _initPorts() {
        this.addPort(50 * this.scale, (H + 32) * this.scale, 'can1p', 'wire', 'p');
        this.addPort(100 * this.scale, (H + 32) * this.scale, 'can1n', 'wire');
        this.addPort((this.w - 100) * this.scale, (H + 32) * this.scale, 'can2p', 'wire', 'p');
        this.addPort((this.w - 50) * this.scale, (H + 32) * this.scale, 'can2n', 'wire');
    }

    // ══════════════════════════════════════════
    //  主循环
    // ══════════════════════════════════════════
    _startLoop() {
        this._loopTimer = setInterval(() => this._tick(), 100);
        this._flashTimer = setInterval(() => { this.flashState = !this.flashState; }, 500);

        // ── 自动启动NMT序列 ──
        if (this.nmtAutoStart) {
            this.nmtStartSequence = setTimeout(() => {
                this._startAllNodes();
            }, this.nmtAutoStartDelay);
        }
    }
    /**
     * 主循环 / 心跳函数
     * 
     * 该函数以固定频率（通常为 30-60fps）被调用，负责：
     * 1. 更新时间显示
     * 2. 模拟底层硬件数据变化
     * 3. 处理报警逻辑
     * 4. 根据当前激活的页面渲染对应的 UI 内容
     * 5. 更新全局报警统计
     * 6. 刷新底层缓存
     */
    _tick() {
        // ── 1. 基础系统更新 ──────────────────────

        // 更新右上角时钟显示
        this._clockText.text(new Date().toTimeString().slice(0, 8));
        // 更新中央机通信状态：物理总线连接与通信故障（以 Bus-Off 作为故障指示）
        try {
            this.busConnected = this.sys.isPortConnected(`${this.id}_wire_can1p`, 'can_wire_can1p') && this.sys.isPortConnected(`${this.id}_wire_can1n`, 'can_wire_can1n');
            if (this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
            else this.sys.canBus.resetNodeOnline(this.id);
        } catch (_) {
            this.busConnected = false;
        }
        // 总线物理连接检测：在上升沿启动心跳广播，在下降沿停止心跳
        try {
            const bus = this.sys?.canBus;
            if (this.busConnected && bus && !this._heartbeatRunning) {
                bus.startHeartbeat(this.id, this.heartbeatIntervalMs);
                this._heartbeatRunning = true;
                console.log('[CC] CAN heartbeat started');
            } else if (!this.busConnected && this._heartbeatRunning && bus) {
                bus.stopHeartbeat();
                this._heartbeatRunning = false;
                console.log('[CC] CAN heartbeat stopped');
            }
        } catch (e) { }
        // 从底层模块（模拟或真实）拉取最新数据到 this.data        
        this._pullModuleData();
        // ── 2. 物理过程模拟 ──────────────────────

        // 模拟液位变化（根据进出水逻辑）         // 模拟温度变化（根据加热/冷却逻辑）
        this._simLevel();
        this._simTemp();
        // ── 3. 报警系统处理 ──────────────────────

        // 检查数据中的故障位，生成或清除报警对象，处理闪烁逻辑        
        this._processAlarms();
        // ── 4. 页面渲染分发 ──────────────────────
        switch (this.activePage) {
            case 0: this._renderAlarmPage(); break;  // 监测报警
            case 1: this._renderParamPage(); break;  // 参数一览
            case 2: this._renderNetworkPage(); break;  // 网络诊断
            case 3: this._renderAISetPage(); break;  // AI 设置
            case 4: this._renderAOPage(); break;  // AO 设置
            case 5: this._renderDISetPage(); break;  // DI 设置
            case 6: this._renderDOPage(); break;  // DO 设置
            case 7: this._renderLevelPage(); break;  // 液位控制
            case 8: this._renderTempPage(); break;  // 温度控制
        }
        // ── 5. 全局状态更新 ──────────────────────       
        // 更新底部状态栏的报警文字
        // 如果有未确认报警，显示红色文字；否则显示灰色提示
        const uc = this.activeAlarms.filter(a => !a.confirmed).length;
        this._alarmCountText.text(uc > 0 ? `报警: ${uc} 条未确认` : '报警: 无');
        this._alarmCountText.fill(uc > 0 ? C.red : C.textDim);
        this._refreshCache();
    }

    // ══════════════════════════════════════════
    //  CAN 总线帧 ID 规范（本系统）
    // ══════════════════════════════════════════
    //
    //  帧 ID 编码：CANId.encode(funcCode, nodeAddr)
    //    bit[10:7] = funcCode (4位)   bit[6:0] = nodeAddr (7位，低4位有效)
    //
    //  功能码（CAN_FUNC）：
    //    AI_REPORT = 0x01  AI 模块 → 中央（4路工程量，大端序 int16×100/10）
    //    AO_STATUS = 0x01  AO 模块 → 中央（输出反馈：mA×100 / 百分比 / 故障字节）
    //    DI_REPORT = 0x01  DI 模块 → 中央（状态字节 / 故障字节 / 报警字节）
    //    DO_STATUS = 0x01  DO 模块 → 中央（状态字节 / 故障字节 / 保持字节 / 脉冲字节）
    //    AO_CMD    = 0x02  中央 → AO 模块（CANParser.buildAOCmd，百分比×100，大端序）
    //    DO_CMD    = 0x02  中央 → DO 模块（CANParser.buildDOCmd，掩码+状态字节）
    //    AI_CONFIG = 0x02  中央 → AO 模块（CANParser.buildAOCmd，百分比×100，大端序）
    //    DI_CONFIG = 0x02  中央 → DO 模块（CANParser.buildDOCmd，掩码+状态字节）  
    //    AI_REPLY = 0x03  AI 模块 → 中央（读取数据应答）
    //    AO_REPLY = 0x03  AO 模块 → 中央（读取数据应答）
    //    DI_REPLY = 0x03  DI 模块 → 中央（读取数据应答）
    //    DO_REPLY = 0x03  DO 模块 → 中央（读取数据应答）      
    //    BROADCAST = 0x0F  广播（心跳/NMT，所有节点均收到）
    //    NMT       = 0x00  网络管理帧
    //
    //  节点地址分配：
    //    0  中央计算机（主站）
    //    1  AI 模拟量输入模块
    //    2  AO 模拟量输出模块
    //    3  DI 数字量输入模块
    //    4  DO 数字量输出模块
    //
    //  接收机制：
    //    总线调用 this.onCanReceive(frame)，被动推送，无需轮询
    //    frame = { id, dlc, data: number[], sender, timestamp }
    //
    // ══════════════════════════════════════════
    //  CAN 接收入口（总线回调）
    // ══════════════════════════════════════════

    /**
     * CANBus 总线回调入口——总线每收到一帧就调用此函数
     * 由 CANBus._dispatch() 自动调用，无需手动轮询
     * @param {CANFrame} frame  — { id, dlc, data: number[], sender, timestamp }
     */
    onCanReceive(frame) {
        if (this.commFault || !this.busConnected) return;
        if (!frame || typeof frame.id !== 'number') return;
        const funcCode = CANId.funcCode(frame.id);
        const nodeAddr = CANId.nodeAddr(frame.id);

        // ── 处理NMT帧（所有节点都需要接收） ──
        if (funcCode === CAN_FUNC.NMT) {
            // NMT帧来自CC自己发送，这里更新本地记录的节点状态
            // 但由于此处是接收帧回调，实际上不会收到自己发送的帧
            // 我们主要依赖_startAllNodes等方法中的显式调用来更新nmtNodeStates
            return;
        }

        switch (nodeAddr) {
            case 1:  // 0x01  AI 上报和回复
                if (funcCode === CAN_FUNC.AI_REPORT) this._canHandleAIReport(frame, nodeAddr);
                else if ((funcCode === CAN_FUNC.AI_REPLY)) this._canHandleAIReply(frame, nodeAddr);
                break;
            case 2:  // 0x02  AO 状态心跳
                if (funcCode === CAN_FUNC.AO_STATUS) this._canHandleAOStatus(frame, nodeAddr);
                else if ((funcCode === CAN_FUNC.AO_REPLY)) this._canHandleAOReply(frame, nodeAddr);
                break;
            case 3:  // 0x03  DI 上报
                if (funcCode === CAN_FUNC.DI_REPORT) this._canHandleDIReport(frame, nodeAddr);
                else if ((funcCode === CAN_FUNC.DI_REPLY)) this._canHandleDIReply(frame, nodeAddr);
                break;
            case 4:  // 0x04  DO 状态心跳
                if (funcCode === CAN_FUNC.DO_STATUS) this._canHandleDOStatus(frame, nodeAddr);
                else if ((funcCode === CAN_FUNC.DO_REPLY)) this._canHandleDOReply(frame, nodeAddr);
                break;
            default:
                break;
        }
    }

    // ══════════════════════════════════════════
    //  NMT 网络管理
    // ══════════════════════════════════════════

    /**
     * 启动所有节点
     * 发送启动(0x01)命令给所有从站节点 (AI=1, AO=2, DI=3, DO=4)
     */
    _startAllNodes() {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;
        if (!this.busConnected || this.commFault) return;

        console.log('[CC] NMT: Starting all nodes...');

        // 发送启动命令给所有节点（广播）
        this.sys.canBus.sendNMT(this.id, NMT_CMD.START, 0);

        // 更新本地记录
        this.nmtNodeStates.ai = NMT_STATE.RUN;
        this.nmtNodeStates.ao = NMT_STATE.RUN;
        this.nmtNodeStates.di = NMT_STATE.RUN;
        this.nmtNodeStates.do = NMT_STATE.RUN;
    }

    /**
     * 停止所有节点
     */
    _stopAllNodes() {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;
        if (!this.busConnected || this.commFault) return;

        console.log('[CC] NMT: Stopping all nodes...');

        this.sys.canBus.sendNMT(this.id, NMT_CMD.STOP, 0);

        // 更新本地记录
        this.nmtNodeStates.ai = NMT_STATE.STOP;
        this.nmtNodeStates.ao = NMT_STATE.STOP;
        this.nmtNodeStates.di = NMT_STATE.STOP;
        this.nmtNodeStates.do = NMT_STATE.STOP;
    }

    /**
     * 复位所有节点
     */
    _resetAllNodes() {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;
        if (!this.busConnected || this.commFault) return;

        console.log('[CC] NMT: Resetting all nodes...');

        this.sys.canBus.sendNMT(this.id, NMT_CMD.RESET, 0);

        // 更新本地记录
        this.nmtNodeStates.ai = NMT_STATE.INIT;
        this.nmtNodeStates.ao = NMT_STATE.INIT;
        this.nmtNodeStates.di = NMT_STATE.INIT;
        this.nmtNodeStates.do = NMT_STATE.INIT;
    }

    /**
     * 针对某个特定节点发送NMT命令
     * @param {string} nodeType - 节点类型 ('ai', 'ao', 'di', 'do')
     * @param {number} cmd - NMT命令代码 (NMT_CMD.START / NMT_CMD.STOP / NMT_CMD.RESET)
     */
    _sendNMTCommand(nodeType, cmd) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;
        if (this.commFault || !this.busConnected) return;
        // 节点地址映射
        const nodeAddrs = { ai: 1, ao: 2, di: 3, do: 4 };
        const addr = nodeAddrs[nodeType];
        if (!addr) return;

        console.log(`[CC] NMT: Sending command 0x${cmd.toString(16)} to ${nodeType} (addr=${addr})`);

        this.sys.canBus.sendNMT(this.id, cmd, addr);

        // 更新本地记录
        if (cmd === NMT_CMD.START) {
            this.nmtNodeStates[nodeType] = NMT_STATE.RUN;
        } else if (cmd === NMT_CMD.STOP) {
            this.nmtNodeStates[nodeType] = NMT_STATE.STOP;
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtNodeStates[nodeType] = NMT_STATE.INIT;
        }
    }

    /**
     * 读取特定节点的配置参数
     * @param {string} nodeType - 节点类型 ('ai', 'ao', 'di', 'do')
     * @param {number} configCmd - 配置命令代码 (0x07, 0x08, 0x09, 0x0A 等)
     * @param {*} param - 参数（如通道索引）
     */
    _requestNodeConfig(nodeType, configCmd, param = 0) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        // 中央机自身通信状态检查：只有物理总线连通且无通信故障时才发送
        if (this.commFault || !this.busConnected) {
            // 标记该节点类型的请求为 pending，等待上线或故障恢复后重试
            if (this.nodeConfigs && this.nodeConfigs[nodeType]) this.nodeConfigs[nodeType].pending = true;
            return;
        }

        // 功能码映射
        const funcCodes = {
            ai: CAN_FUNC.AI_CONFIG,
            ao: CAN_FUNC.AO_CMD,
            di: CAN_FUNC.DI_CONFIG,
            do: CAN_FUNC.DO_CMD,
        };

        const nodeAddrs = { ai: 1, ao: 2, di: 3, do: 4 };
        const funcCode = funcCodes[nodeType];
        const addr = nodeAddrs[nodeType];

        if (!funcCode || !addr) return;

        // 构造配置请求帧
        const frameId = CANId.encode(funcCode, addr);
        const data = [configCmd, param & 0xFF, 0, 0, 0, 0, 0, 0];

        this.sys.canBus.send({
            id: frameId,
            extended: false,
            rtr: false,
            dlc: 8,
            data,
            sender: this.id,
            timestamp: Date.now(),
        });
    }

    // ══════════════════════════════════════════
    //  接收处理函数（各节点上报）
    // ══════════════════════════════════════════

    /**
     * 处理 AI 上报帧（funcCode=0x01，来自 AI 模块节点）
     *
     * 使用 CANParser.parseAIReport(frame) 解析：
     *   ch1 / ch2：raw = int16 大端，scale=100  → value = raw/100
     *   ch3 / ch4：raw = int16 大端，scale=10   → value = raw/10
     *   raw === 0x7FFF 为断路/超范围哨兵值
     *
     * @param {CANFrame} frame
     * @param {number}   nodeAddr  发送方节点地址（固定为 1）
     */
    _canHandleAIReport(frame, nodeAddr) {
        const parsed = CANParser.parseAIReport(frame);
        if (!parsed) return;

        let hasError = false;
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const ch = parsed[id];
            if (!ch) return;
            // 0xFFFF 为节点定义的断路/超范围哨兵值
            if (ch.raw === 32768) {
                this.data.ai[id].fault = true;
                hasError = true;  // 标记有错误
            } else {
                this.data.ai[id].fault = false;
                this.data.ai[id].value = ch.raw / ch.scale;
            }
        });

        // ── 当检测到任何通道错误时，立即发送命令0A查询详细状态 ──
        if (hasError) {
            this._requestNodeConfig('ai', 0x0A, 0);
        }

        this._canNodeLastSeen[nodeAddr] = Date.now();
    }

    /**
     * 处理 AI 配置回复帧（funcCode=0x03，来自 AI 模块节点）
     * 
     * 处理命令0A的响应：读取所有通道的报警和故障状态
     * 数据格式：[命令0x0A, 通道1字节, 通道2字节, 通道3字节, 通道4字节, 保留, 保留]
     * 每通道字节：高4位=报警码(0=normal, 1=LL, 2=L, 3=H, 4=HH)
     *           低4位=故障码(0=normal, 1=OPEN, 2=SHORT, 3=OUTRANGE)
     * 
     * @param {CANFrame} frame
     * @param {number}   nodeAddr  发送方节点地址（固定为 1）
     */

    /**
     * 辅助方法：将两个字节转为有符号 16 位整数
     * @param {number} b1 高字节
     * @param {number} b2 低字节
     * @returns {number} 有符号 16 位整数值
     */
    _bytesToInt16(b1, b2) {
        let value = ((b1 << 8) | b2);
        // 如果最高位为 1，则是负数（两补码）
        if (value & 0x8000) {
            value = -(0x10000 - value);
        }
        return value;
    }

    _canHandleAIReply(frame, nodeAddr) {
        if (!frame || frame.data.length < 5) return;

        const cmd = frame.data[0];
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];

        // 处理量程/单位响应 (0x09)
        if (cmd === 0x09) {
            const chIdx = frame.data[1] & 0x03;
            const chId = chKeys[chIdx];
            // 使用有符号 16 位整数处理（将两字节转为有符号数）
            const urvRaw = this._bytesToInt16(frame.data[2], frame.data[3]);
            const lrvRaw = this._bytesToInt16(frame.data[4], frame.data[5]);
            const urv = urvRaw / 100;
            const lrv = lrvRaw / 100;
            const unitCode = frame.data[6] & 0xFF;
            const unitMap = { 1: 'MPa', 2: 'bar', 3: '°C', 4: 'cm', 5: 'L/min', 6: '%' };
            const unit = unitMap[unitCode] || '--';
            if (!this.data.ai[chId]) this.data.ai[chId] = {};
            this.data.ai[chId].ranges = { urv, lrv, unit };
            console.log(`[CC] 收到AI 0x09响应 ${chId} urv=${urv} lrv=${lrv} unit=${unit}`);
            this._updateAIRowFromModule(chId);
            this._canNodeLastSeen[nodeAddr] = Date.now();
            return;
        }

        // 处理 HH/LL 响应 (0x07)
        if (cmd === 0x07) {
            const chIdx = frame.data[1] & 0x03;
            const chId = chKeys[chIdx];
            // 使用有符号 16 位整数处理
            const hhRaw = this._bytesToInt16(frame.data[2], frame.data[3]);
            const llRaw = this._bytesToInt16(frame.data[4], frame.data[5]);
            const hh = hhRaw / 10;
            const ll = llRaw / 10;
            if (!this.data.ai[chId]) this.data.ai[chId] = {};
            if (!this.data.ai[chId].alarms) this.data.ai[chId].alarms = {};
            this.data.ai[chId].alarms.hh = hh;
            this.data.ai[chId].alarms.ll = ll;
            console.log(`[CC] 收到AI 0x07响应 ${chId} HH=${hh} LL=${ll}`);
            this._updateAIRowFromModule(chId);
            this._canNodeLastSeen[nodeAddr] = Date.now();
            return;
        }

        // 处理 H/L 响应 (0x08)
        if (cmd === 0x08) {
            const chIdx = frame.data[1] & 0x03;
            const chId = chKeys[chIdx];
            // 使用有符号 16 位整数处理
            const hRaw = this._bytesToInt16(frame.data[2], frame.data[3]);
            const lRaw = this._bytesToInt16(frame.data[4], frame.data[5]);
            const h = hRaw / 10;
            const l = lRaw / 10;
            if (!this.data.ai[chId]) this.data.ai[chId] = {};
            if (!this.data.ai[chId].alarms) this.data.ai[chId].alarms = {};
            this.data.ai[chId].alarms.h = h;
            this.data.ai[chId].alarms.l = l;
            console.log(`[CC] 收到AI 0x08响应 ${chId} H=${h} L=${l}`);
            this._updateAIRowFromModule(chId);
            this._canNodeLastSeen[nodeAddr] = Date.now();
            return;
        }

        // 处理 0x0A（总体报警/故障状态）
        // 注：不要直接使用报文中的报警码（高4位）作为显示报警，
        // 只保留故障码（低4位）用于故障标记。报警由本端根据当前参数值
        // 与配置的阈值（HH/H/L/LL）计算得出，以保证显示与设置一致。
        if (cmd === 0x0A) {
            const faultMap = { 0: 'normal', 1: 'OPEN', 2: 'SHORT', 3: 'OUTRANGE' };
            const faultText = { OPEN: '开路', SHORT: '短路', OUTRANGE: '超量程' };
            const alarmText = { LL: '低低限', L: '低限', H: '高限', HH: '高高限', normal: 'normal', FAULT: 'FAULT' };

            chKeys.forEach((chId, idx) => {
                const statusByte = frame.data[idx + 1] || 0;  // Data[1-4]
                const faultCode = statusByte & 0x0F;         // 低4位：故障码

                if (!this.data.ai[chId]) this.data.ai[chId] = {};

                // 先处理故障信息（仍使用报文中故障位）
                const faultStatus = faultMap[faultCode] || 'normal';
                this.data.ai[chId].fault = faultCode !== 0;
                this.data.ai[chId].faultText = faultText[faultStatus] || 'normal';

                // 从缓存或模块读取当前值与阈值配置（优先 this.data）
                const cached = this.data.ai[chId] || {};
                const aiModule = (this.sys && this.sys.comps && this.sys.comps['ai']) ? this.sys.comps['ai'] : null;
                const val = (cached.value !== undefined && cached.value !== null) ? cached.value : (aiModule && aiModule.channels && aiModule.channels[chId] ? aiModule.channels[chId].value : undefined);

                const alarmsCfg = (cached.alarms) ? cached.alarms : (aiModule && aiModule.alarms && aiModule.alarms[chId] ? aiModule.alarms[chId] : {});
                const hh = (typeof alarmsCfg.hh === 'number') ? alarmsCfg.hh : undefined;
                const h = (typeof alarmsCfg.h === 'number') ? alarmsCfg.h : undefined;
                const l = (typeof alarmsCfg.l === 'number') ? alarmsCfg.l : undefined;
                const ll = (typeof alarmsCfg.ll === 'number') ? alarmsCfg.ll : undefined;

                // 计算报警优先级：HH > H > normal > L > LL
                let alarmCode = 'normal';
                if (this.data.ai[chId].fault) {
                    alarmCode = 'FAULT';
                } else if (val !== undefined && !isNaN(val)) {
                    if (hh !== undefined && val >= hh) alarmCode = 'HH';
                    else if (h !== undefined && val >= h) alarmCode = 'H';
                    else if (ll !== undefined && val <= ll) alarmCode = 'LL';
                    else if (l !== undefined && val <= l) alarmCode = 'L';
                    else alarmCode = 'normal';
                } else {
                    // 数值未知，保守处理为 normal（或保持原样）
                    alarmCode = 'normal';
                }

                this.data.ai[chId].alarm = alarmText[alarmCode]; // 使用代码表示（normal/LL/L/H/HH/FAULT）
            });

            // 通知页面更新显示（渲染逻辑应读取 this.data.ai[*].alarm）
            this._updateAIChannelDisplay();
            this._canNodeLastSeen[nodeAddr] = Date.now();
            return;
        }
    }

    /**
     * 更新AI通道页面的显示状态
     * 根据报警和故障信息，设置相应的背景色和提示信息
     */
    _updateAIChannelDisplay() {
        // 这个方法会在页面渲染时被调用
        // 可以根据 this.data.ai 的alarm和fault字段进行UI更新
        const alarmColors = {
            'normal': '#ffffff',   // 白色
            'LL': '#0066cc',      // 蓝色（低低报警）
            'L': '#00cc00',       // 绿色（低报警）
            'H': '#ffcc00',       // 黄色（高报警）
            'HH': '#ff3333',      // 红色（高高报警）
        };
        // 实际的UI更新逻辑应该集成到页面渲染中
    }

    /**
     * 处理 AO 状态心跳帧（funcCode=0x02，来自 AO 模块节点）
     *
     * 使用 CANParser.parseAOStatus(frame) 解析：
     *   ch1mA100  / ch2mA100：电流输出值×100（0.01mA 精度）
     *   ch3Pct    / ch4Pct  ：PWM 通道百分比 0~100
     *   faultByte：bit0=ch1故障 … bit3=ch4故障
     *
     * @param {CANFrame} frame
     * @param {number}   nodeAddr  发送方节点地址（固定为 2）
     */
    _canHandleAOStatus(frame, nodeAddr) {
        const parsed = CANParser.parseAOStatus(frame);
        if (!parsed) return;

        // CH1 / CH2：4-20mA，从 mA×100 反算百分比 (4mA=0%, 20mA=100%)
        const maToPct = (mA100) => Math.max(0, Math.min(100, ((mA100 / 100) - 4) / 16 * 100));
        this.data.ao.ch1.actual = parsed.ch1mA100 / 100;
        this.data.ao.ch1.percent = maToPct(parsed.ch1mA100);
        this.data.ao.ch2.actual = parsed.ch2mA100 / 100;
        this.data.ao.ch2.percent = maToPct(parsed.ch2mA100);

        // CH3 / CH4：PWM，直接为百分比
        this.data.ao.ch3.actual = parsed.ch3Pct;
        this.data.ao.ch3.percent = parsed.ch3Pct;
        this.data.ao.ch4.actual = parsed.ch4Pct;
        this.data.ao.ch4.percent = parsed.ch4Pct;

        // 故障位拆解
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach((id, i) => {
            this.data.ao[id].fault = !!(parsed.faultByte & (1 << i));
        });

        this._canNodeLastSeen[nodeAddr] = Date.now();
    }

    /**
     * 处理 DI 上报帧（funcCode=0x03，来自 DI 模块节点）
     *
     * 使用 CANParser.parseDIReport(frame) 解析：
     *   stateByte：bit0=ch1 … bit3=ch4（1=ON）
     *   faultByte：bit0=ch1 … bit3=ch4（1=故障）
     *   alarmByte：保留，供后续扩展
     *   ch1State … ch4State：已解析的布尔值
     *
     * @param {CANFrame} frame
     * @param {number}   nodeAddr  发送方节点地址（固定为 3）
     */
    _canHandleDIReport(frame, nodeAddr) {
        const parsed = CANParser.parseDIReport(frame);
        if (!parsed) return;

        ['ch1', 'ch2', 'ch3', 'ch4'].forEach((id, i) => {
            const newState = parsed[`${id}State`];
            const fault = !!(parsed.faultByte & (1 << i));

            // 上升沿检测：当前 ON 且上一帧为 OFF → 计数+1
            if (newState && !this._diPrevState[id]) {
                this.data.di[id].counter = (this.data.di[id].counter || 0) + 1;
            }
            this._diPrevState[id] = newState;
            this.data.di[id].state = newState;
            this.data.di[id].fault = fault;
        });

        this._canNodeLastSeen[nodeAddr] = Date.now();
    }

    /**
     * 处理 DO 状态心跳帧（funcCode=0x04，来自 DO 模块节点）
     *
     * 使用 CANParser.parseDOStatus(frame) 解析：
     *   stateByte：bit0=ch1 … bit3=ch4（当前输出状态）
     *   faultByte：bit0=ch1 … bit3=ch4（故障）
     *   holdByte ：bit0=ch1 … bit3=ch4（通信超时安全保持）
     *   pulseByte：脉冲输出状态（保留）
     *   ch1State … ch4State：已解析的布尔值
     *
     * @param {CANFrame} frame
     * @param {number}   nodeAddr  发送方节点地址（固定为 4）
     */
    _canHandleDOStatus(frame, nodeAddr) {
        const parsed = CANParser.parseDOStatus(frame);
        if (!parsed) return;

        ['ch1', 'ch2', 'ch3', 'ch4'].forEach((id, i) => {
            this.data.do[id].state = parsed[`${id}State`];
            this.data.do[id].fault = !!(parsed.faultByte & (1 << i));
            this.data.do[id].hold = !!(parsed.holdByte & (1 << i));
        });

        this._canNodeLastSeen[nodeAddr] = Date.now();
    }

    /**
     * 处理广播心跳帧（funcCode=0x0F，由 CANBus.startHeartbeat 发出）
     * 数据域：[0x05, 0x00] → 0x05=Operational
     * 此帧的 sender 即为发送方模块 id，nodeAddr 通常为 0（主站广播）
     *
     * @param {CANFrame} frame
     * @param {number}   nodeAddr
     */
    _canHandleBroadcast(frame, nodeAddr) {
        // 广播帧由主站（中央计算机自身）发出，用于告知从站主站在线
        // 中央计算机收到自己的广播时（loopback=false 则不会收到），忽略即可
        // 若未来需要从站发送心跳可在此扩展
        void nodeAddr;
    }

    /**
     * 处理 NMT 网络管理帧（funcCode=0x00）
     * 数据域：[cmd, targetAddr]
     *   cmd=0x01 启动  0x02 停止  0x81 复位应用  0x82 复位通信
     *   targetAddr=0x00 广播全部节点
     *
     * @param {CANFrame} frame
     */
    _canHandleNMT(frame) {
        if (!frame.data || frame.data.length < 2) return;
        const cmd = frame.data[0];
        const targetAddr = frame.data[1];
        // 中央计算机作为主站，一般只发不收 NMT
        // 若收到其他主站的 NMT（多主站场景），此处可做相应处理
        if (this.verbose) {
            console.log(`[CC] NMT cmd=0x${cmd.toString(16)} target=${targetAddr}`);
        }
    }

    // ══════════════════════════════════════════
    //  发送函数（中央计算机下行指令）
    // ══════════════════════════════════════════

    /**
     * 发送 AO 输出指令 → AO 节点（nodeAddr=2，funcCode=AO_CMD=0x02）
     *
     * 使用 CANParser.buildAOCmd(ch1Pct, ch2Pct, ch3Pct, ch4Pct) 构建数据域：
     *   每通道 2 字节大端，百分比×100，0xFFFF=保持原值
     *   手动模式：使用 aoManualVal；自动模式：使用 data.ao 当前值
     *
     * 通过 bus.sendCommand(senderId, funcCode, nodeAddr, data[]) 发送
     */
    _canSendAOCommand() {
        const bus = this.sys?.canBus;
        if (!bus) return;
        if (this.commFault || !this.busConnected) return; // 中央通信不可用时跳过下行

        const [ch1, ch2, ch3, ch4] = ['ch1', 'ch2', 'ch3', 'ch4'].map(id => {
            return this.aoManual[id]
                ? (this.aoManualVal[id] ?? 0)
                : null;  // null → 0xFFFF（保持原值），由 buildAOCmd 处理
        });

        const data = CANParser.buildAOCmd(ch1, ch2, ch3, ch4);
        try {
            bus.sendCommand(this.id, CAN_FUNC.AO_CMD, 2, data);
        } catch (e) {
            // Bus-Off 或静默模式，忽略发送错误
        }
    }
    _canSendAIConfig() {
        const bus = this.sys?.canBus;
        if (!bus) return;
        if (this.commFault || !this.busConnected) return;

    }
    /**
     * 发送 DO 输出指令 → DO 节点（nodeAddr=4，funcCode=DO_CMD=0x04）
     *
     * 使用 CANParser.buildDOCmd(ch1, ch2, ch3, ch4) 构建数据域：
     *   Data[0]=0x01（直接控制命令字）
     *   Data[1]=掩码字节（哪些通道需要更新）
     *   Data[2]=状态字节（对应通道置 ON/OFF）
     *   Data[3]=保留
     *
     * 手动模式通道：使用 doManualState；非手动通道：传 undefined（掩码位不置位）
     */
    _canSendDOCommand() {
        const bus = this.sys?.canBus;
        if (!bus) return;
        if (this.commFault || !this.busConnected) return; // 中央通信不可用时跳过下行

        const [ch1, ch2, ch3, ch4] = ['ch1', 'ch2', 'ch3', 'ch4'].map(id => {
            // 仅手动模式的通道才下发强制指令（掩码位置位）
            // 自动模式由 DO 模块自身逻辑决定，中央计算机不干预
            return this.doManual[id] ? this.doManualState[id] : undefined;
        });

        const data = CANParser.buildDOCmd(ch1, ch2, ch3, ch4);
        try {
            bus.sendCommand(this.id, CAN_FUNC.DO_CMD, 4, data);
        } catch (e) {
            // Bus-Off 或静默模式，忽略发送错误
        }
    }
    _canSendDIConfig() {
        const bus = this.sys?.canBus;
        if (!bus) return;
        if (this.commFault || !this.busConnected) return;

    }
    /**
     * 发送 NMT 网络管理帧（广播，funcCode=NMT=0x00）
     * @param {number} cmd         0x01=启动  0x02=停止  0x81=复位应用  0x82=复位通信
     * @param {number} [targetAddr=0]  目标节点，0=广播全部
     */
    _canSendNMT(cmd, targetAddr = 0) {
        const bus = this.sys?.canBus;
        if (!bus) return;
        console.log('CC总线连接：', this.busConnected);
        // 中央通信状态检查
        if (this.commFault || !this.busConnected) return;
        try {
            bus.sendNMT(this.id, cmd, targetAddr);
        } catch (e) { }
    }

    // ══════════════════════════════════════════
    //  数据拉取（每 tick 由 _tick() 调用）
    // ══════════════════════════════════════════

    /**
     * _pullModuleData —— CAN 总线数据收发主入口
     *
     * 接收方向：数据由 onCanReceive(frame) 回调被动更新，此处无需主动读取。
     *
     * 执行顺序：
     *   1. 向 AO 节点发送输出指令帧（手动通道）
     *   2. 向 DO 节点发送输出指令帧（手动通道）
     *   3. 通信超时检测（节点最近一次上报时间 > 2s → 标记 fault/hold）
     *   4. 更新底部状态栏节点在线摘要
     *   5. 同步网络诊断页节点状态显示
     */
    _pullModuleData() {
        // ── 步骤 1：发送下行指令帧 ───────────
        // this._canSendAOCommand();
        // this._canSendDOCommand();

        // ── 步骤 2：通信超时检测 ────────────────
        //   节点心跳/上报周期建议 ≤ 500ms；
        //   超过 2000ms 未收到任何帧 → 判定为通信超时
        const now = Date.now();
        const TIMEOUT = 2000;

        // 节点地址 → 模块数据映射
        const nodeMap = {
            1: { label: 'AI', dataKey: 'ai', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
            2: { label: 'AO', dataKey: 'ao', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
            3: { label: 'DI', dataKey: 'di', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
            4: { label: 'DO', dataKey: 'do', keys: ['ch1', 'ch2', 'ch3', 'ch4'] },
        };

        const onlineNodes = [];
        const offlineNodes = [];

        Object.entries(nodeMap).forEach(([addrStr, meta]) => {
            const addr = parseInt(addrStr);
            //上次出现的时间，没有出现过为0
            const lastSeen = this._canNodeLastSeen[addr] || 0;
            // 确定节点超时
            const timeout = lastSeen > 0 && (now - lastSeen) > TIMEOUT;
            // 定义节点从未出现
            const neverSeen = lastSeen === 0;

            if (timeout) {
                // 离线节点里面是大写的类型文本
                offlineNodes.push(meta.label);
                // 超时节点：所有通道置故障+保持
                meta.keys.forEach(id => {
                    // 系统数据快照，节点不在线，设置故障位和保持位
                    const ch = this.data[meta.dataKey][id];
                    if (ch) { ch.fault = true; ch.hold = true; }
                });
            } else if (!neverSeen) {
                // 除开了超时、除开了从未出现，则是在线节点。
                onlineNodes.push(meta.label);
                // 恢复：清除保持标志（fault 由帧内容决定）
                meta.keys.forEach(id => {
                    const ch = this.data[meta.dataKey][id];
                    if (ch && ch.hold) ch.hold = false;
                });
            }
        });

        // ── 步骤 4：更新底部状态栏 ─────────────
        const busOff = this.sys?.canBus?.isBusOff?.() ?? false;
        if (busOff || !this.busConnected) {
            this._statusText.text('✖ CAN BUS OFF');
            this._statusText.fill(C.red);
            this._nodeText.text(`NODE: ---`);
            this._nodeText.fill(C.green);
        } else if (offlineNodes.length > 0) {
            this._statusText.text(`⚠ CAN: ${offlineNodes.join('·')} 超时`);
            this._statusText.fill(C.red);
            this._nodeText.text(`NODE: ${onlineNodes.join('·') || '无在线节点'}`);
            this._nodeText.fill(C.yellow);
        } else if (onlineNodes.length > 0) {
            this._statusText.text('● CAN BUS ONLINE');
            this._statusText.fill(C.green);
            this._nodeText.text(`NODE: ${onlineNodes.join('·')}`);
            this._nodeText.fill(C.green);
        } else {
            this._statusText.text('● CAN BUS ONLINE');
            this._statusText.fill(C.green);
            this._nodeText.text(`NODE: ${onlineNodes.join('·')}`);
            this._nodeText.fill(C.green);
        }

        // 如果 AI 的参数请求处于 pending 且 AI 现在在线且中央通信正常，立即触发参数读取
        try {
            const bus = this.sys?.canBus;
            const aiOnline = bus ? bus.isNodeOnline('ai') : false;
            if (aiOnline && this.nodeConfigs.ai && this.nodeConfigs.ai.pending && this.busConnected && !this.commFault) {
                this.nodeConfigs.ai.pending = false;
                this.nodeConfigs.ai.available = true;
                console.log('[CC] AI 上线，触发参数初始化读取');
                this._initAIParams();
            }
        } catch (_) { }

        // ── 步骤 5：同步网络诊断页节点指示灯 ───
        if (this._netRowDisps) {
            Object.entries(nodeMap).forEach(([addrStr, meta]) => {
                const addr = parseInt(addrStr);
                const row = this._netRowDisps[addr];
                if (!row) return;
                const lastSeen = this._canNodeLastSeen[addr] || 0;
                const online = lastSeen > 0 && (now - lastSeen) < TIMEOUT;
                row.dot.fill(online ? C.green : (lastSeen === 0 ? C.textDim : C.red));
            });
        }
    }

    // ══════════════════════════════════════════
    //  液位仿真
    // ══════════════════════════════════════════
    _simLevel() {
        const lc = this.levelCtrl;
        if (!lc.simMode) return;

        if (lc.inletOn) lc.level = Math.min(100, lc.level + 0.3);
        if (lc.drainOn) lc.level = Math.max(0, lc.level - 0.5);
        lc.level = Math.max(0, lc.level - 0.04); // 自然消耗

        // 双位控制逻辑
        if (lc.level <= lc.setL) lc.inletOn = true;
        if (lc.level >= lc.setH) lc.inletOn = false;
        if (lc.level <= lc.setL) lc.drainOn = false;
        if (lc.level >= lc.setH) lc.drainOn = true;

        this._levelTrendHistory.push(lc.level);
        if (this._levelTrendHistory.length > 350) this._levelTrendHistory.shift();
    }

    // ══════════════════════════════════════════
    //  温度仿真
    // ══════════════════════════════════════════
    _simTemp() {
        const tc = this.tempCtrl;
        const err = tc.sv - tc.pv;
        if (tc.mode === 'AUTO') tc.out = Math.max(0, Math.min(100, 50 + err * 1.8));
        const heat = (tc.out / 100) * 0.6;
        const cool = (tc.pv - 20) * 0.012;
        tc.pv = Math.max(0, Math.min(200, tc.pv + heat - cool));
        tc.history.push({ pv: tc.pv, sv: tc.sv, out: tc.out });
        if (tc.history.length > tc.maxHist) tc.history.shift();
    }

    // ══════════════════════════════════════════
    //  报警处理（参照 Monitor.js）
    // ══════════════════════════════════════════
    _processAlarms() {
        const now = Date.now();
        const detected = [];

        // 采集故障
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const faultText = this.data.ai[id]?.faultText;
            if (this.data.ai[id]?.fault) detected.push(`AI ${id.toUpperCase()}通道 ${faultText}故障`);
            if (this.data.ao[id]?.fault) detected.push(`AO ${id.toUpperCase()}通道 输出故障`);
            if (this.data.di[id]?.fault) detected.push(`DI ${id.toUpperCase()}通道 回路故障`);
            if (this.data.do[id]?.fault) detected.push(`DO ${id.toUpperCase()}通道 输出故障`);
        });

        // AI 报警阈值
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const alm = this.data.ai[id]?.alarm;
            if (alm && alm !== 'normal' && alm !== 'FAULT') {
                detected.push(`AI ${id.toUpperCase()}通道 ${alm}报警`);
            }
        });

        // 液位报警
        const lc = this.levelCtrl;
        if (lc.level >= lc.setHH) detected.push('液位 HH 高高报警');
        if (lc.level <= lc.setLL) detected.push('液位 LL 低低报警');

        // 温度报警
        if (this.tempCtrl.pv > 90) detected.push(`出口温度过高 (${this.tempCtrl.pv.toFixed(1)}°C)`);

        // 延时触发
        detected.forEach(txt => {
            if (!this.faultTimers[txt]) this.faultTimers[txt] = now;
            else if (now - this.faultTimers[txt] >= this.alarmDelay) this._triggerAlarm(txt);
        });

        // 清理已消失的计时器
        Object.keys(this.faultTimers).forEach(k => { if (!detected.includes(k)) delete this.faultTimers[k]; });

        // 更新物理活跃状态
        this.activeAlarms.forEach(a => {
            if (!a.confirmed) a.isPhysicalActive = detected.includes(a.text);
        });

        if (this.activeAlarms.length > this.maxAlarmLines) this.activeAlarms = this.activeAlarms.slice(0, this.maxAlarmLines);
    }

    _triggerAlarm(txt) {
        if (!this.activeAlarms.find(a => a.text === txt && !a.confirmed)) {
            this.activeAlarms.unshift({
                id: ++this.alarmIdCounter, text: txt,
                confirmed: false, muted: false, isPhysicalActive: true,
                timestamp: new Date().toTimeString().slice(0, 8),
            });
        }
    }

    // ══════════════════════════════════════════
    //  各页面渲染
    // ══════════════════════════════════════════
    //  ---页面0---报警页面渲染
    _renderAlarmPage() {
        //---重要的信息存储在  this.activeAlarms[i]  最多15条
        this._alarmLines.forEach((line, i) => {
            const a = this.activeAlarms[i];
            if (a) {
                // 前面两项是时间和故障是否还物理存在
                line.text(`${a.timestamp}  ${a.isPhysicalActive ? '[ACT]' : '[CLR]'}  ${a.text}`);
                // 这里显示有三种状态：绿色已确认。未确认要么是红色、要么是黑色（闪烁中）
                if (!a.confirmed) line.fill((!a.muted && this.flashState) ? C.text : C.red);
                else line.fill(C.green);
            } else {
                line.text(i === 0 && this.activeAlarms.length === 0 ? '--:--:--  ● 系统运行正常，无报警' : '');
                line.fill(C.green);
            }
        });
        const flashing = this.activeAlarms.some(a => !a.confirmed && !a.muted);
        const unconf = this.activeAlarms.some(a => !a.confirmed);
        if (flashing) this._alarmLed.fill(this.flashState ? C.red : '#330000');
        else if (unconf) this._alarmLed.fill(C.red);
        else this._alarmLed.fill('#220000');
    }

    // 页面1---参数一览界面
    _renderParamPage() {
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];

        // AI
        chKeys.forEach((id, i) => {
            // 获取数据通道
            const d = this.data.ai[id]; if (!d) return;
            // 获取参数显示文本框
            const r = this._paramDisplays.ai[i];
            // 故障红色、报警黄色、正常绿色
            const c = d.fault ? C.red : (d.alarm !== 'normal' ? C.yellow : C.green);
            // 故障显示故障文本、正常显示参数和单位
            r.val.text(d.fault ? `${d.faultText}` : `${d.value.toFixed(2)} ${d.unit}`);
            r.val.fill(c);
            //这里的宽度应该不是减去0，除以100,而是减去零点，除以量程。
            r.bar.width(d.fault ? 0 : Math.round(Math.min(1, (d.value - 0) / 100) * r.maxBarW));
        });
        // AO
        chKeys.forEach((id, i) => {
            const d = this.data.ao[id]; if (!d) return;
            const r = this._paramDisplays.ao[i];
            r.val.text(d.fault ? 'FAULT' : `${(d.percent ?? 0).toFixed(1)}%`);
            r.val.fill(d.fault ? C.red : (d.percent > 0 ? C.orange : C.textDim));
            r.bar.width(Math.round((d.percent ?? 0) / 100 * r.maxBarW));
        });
        // DI
        chKeys.forEach((id, i) => {
            const d = this.data.di[id]; if (!d) return;
            const r = this._paramDisplays.di[i];
            r.val.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            r.val.fill(d.fault ? C.red : (d.state ? C.green : C.textDim));
            r.bar.width(d.state ? r.maxBarW : 0);
        });
        // DO
        chKeys.forEach((id, i) => {
            const d = this.data.do[id]; if (!d) return;
            const r = this._paramDisplays['do_'][i];
            r.val.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            r.val.fill(d.fault ? C.red : (d.state ? C.purple : C.textDim));
            r.bar.width(d.state ? r.maxBarW : 0);
        });
    }

    // ══════════════════════════════════════════
    //  PAGE 2 渲染 — 网络诊断
    // ══════════════════════════════════════════
    /**
     * 每 tick 刷新网络诊断页：
     *  - 各节点在线/离线状态（bus.isNodeOnline() + _canNodeLastSeen 超时双重判断）
     *  - 总线统计（bus.getStats()：TX/RX/ERR帧数、总线负载、Bus-Off状态）
     *  - 最近上报时效（最近一次收到该节点帧距今多少秒）
     */
    _renderNetworkPage() {
        if (!this._netRowDisps) return;

        const bus = this.sys?.canBus;
        const now = Date.now();
        const TIMEOUT = 2000;

        // ── 节点状态行 ───────────────────────────
        // nodeAddr → 对应的模块 id（需与 bus.attach 时使用的 module.id 一致）
        const nodeIdMap = { 1: 'ai', 2: 'ao', 3: 'di', 4: 'do' };

        [1, 2, 3, 4].forEach(addr => {
            // ===存储网络数据的结构 this._netRowDisps[addr]
            const row = this._netRowDisps[addr];
            if (!row) return;
            const lastSeen = this._canNodeLastSeen[addr] || 0;
            const timeout = lastSeen > 0 && (now - lastSeen) > TIMEOUT;
            const neverSeen = lastSeen === 0;

            // 双重判断：总线层在线 AND 最近有上报帧
            const busOnline = bus ? bus.isNodeOnline(nodeIdMap[addr]) : false;
            const frameAlive = !neverSeen && !timeout;
            const online = busOnline && frameAlive;

            let statusStr;
            let statusColor;
            statusStr = neverSeen ? 'NO DATA'
                : timeout ? 'TIMEOUT'
                    : busOnline ? 'ONLINE'
                        : 'BUS OFFLINE';
            statusColor = online ? C.green : (neverSeen ? C.textDim : C.red);


            const age = lastSeen > 0 ? `${((now - lastSeen) / 1000).toFixed(1)}s ago` : '---';
            // this._netRowDisps每一行里面存储的圆点、状态文字、模块地址、心跳时间
            // 圆点在线绿色、从不在线黑色、上线过又不在线了红色
            row.dot.fill(online ? C.green : (neverSeen ? C.textDim : C.red));
            // NMT 状态从不上线NO DATA、心跳超时 TIMEOUT、在线正常收发ONLINE、已启动未有数据RUN (no data)
            row.status.text(statusStr);
            row.status.fill(statusColor);
            row.age.text(age);
        });

        // ── 总线统计（bus.getStats()）───────────
        if (this._netStatsText && bus) {
            const s = bus.getStats();
            const busOffStr = s.busOff ? '是⚠' : '否';
            const loadColor = s.busLoad > 80 ? C.red : (s.busLoad > 50 ? C.yellow : C.green);
            this._netStatsText.text(
                `TX:${s.txFrames}  RX:${s.rxFrames}  ERR:${s.errorFrames}  ` +
                `LOAD:${s.busLoad.toFixed(1)}%  DROPPED:${s.dropped}  BUS-OFF:${busOffStr}`
            );
            this._netStatsText.fill(s.busOff ? C.red : loadColor);
        }
    }

    // ══════════════════════════════════════════
    //  PAGE 3 渲染 — AI 设置
    // ══════════════════════════════════════════
    /**
     * 刷新 AI 设置页：显示各通道当前采样值、工程量和报警状态
     */
    _renderAISetPage() {
        if (!this._aiRows) return;
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const row = this._aiRows[id];
            const d = this.data.ai[id];
            if (!row || !d) return;
            row.valDisplay.text(d.fault ? `${d.faultText}` : `${d.value.toFixed(2)} ${d.unit}`);
            row.valDisplay.fill(d.fault ? C.red : C.green);
        });
    }
    //---页面4---AO设置
    _renderAOPage() {
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const d = this.data.ao[id]; const row = this._aoRows[id]; if (!d || !row) return;
            const isMa = d.type === '4-20mA';
            row.curVal.text(d.fault ? 'FAULT' : `${(d.percent ?? 0).toFixed(1)}%  /  ${isMa ? `${(d.actual ?? 4).toFixed(2)} mA` : `${(d.actual ?? 0).toFixed(0)}% PWM`}`);
            row.curVal.fill(d.fault ? C.red : C.text);
        });
    }

    // ══════════════════════════════════════════
    //  PAGE 5 渲染 — DI 设置
    // ══════════════════════════════════════════
    /**
     * 刷新 DI 设置页：状态、上升沿计数
     */
    _renderDISetPage() {
        if (!this._diRows) return;
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const d = this.data.di[id];
            const row = this._diRows[id];
            if (!d || !row) return;
            row.stateDisp.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            row.stateDisp.fill(d.fault ? C.red : (d.state ? C.green : C.textDim));
            row.counterDisp.text(String(d.counter || 0));
        });
    }


    // ---页面6----DO设置
    _renderDOPage() {
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const d = this.data.do[id]; const row = this._doRows[id]; if (!d || !row) return;
            row.stateDisp.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            row.stateDisp.fill(d.fault ? C.red : (d.state ? C.purple : C.textDim));
            row.infoText.text(d.hold ? '⚠ 通信超时，已进入安全保持' : (this.doManual[id] ? '手动控制模式' : '自动控制模式'));
            row.infoText.fill(d.hold ? C.yellow : C.textDim);
        });
    }

    // ---页面7 ----液位控制
    _renderLevelPage() {
        const lc = this.levelCtrl;
        const tkH = 210, tkY = 26;
        const fillH = Math.round(tkH * lc.level / 100);
        this._lvFill.y(tkY + tkH - fillH - 2);
        this._lvFill.height(fillH);
        let fc = C.cyan + '77';
        if (lc.level >= lc.setHH || lc.level <= lc.setLL) fc = C.red + '99';
        else if (lc.level >= lc.setH || lc.level <= lc.setL) fc = C.yellow + '88';
        this._lvFill.fill(fc);
        this._lvText.text(`${lc.level.toFixed(1)}%`);

        this._inletFlowBar.width(lc.inletOn ? 32 : 0);
        this._drainFlowBar.width(lc.drainOn ? 32 : 0);

        this._pumpText.text(`进水阀:  ${lc.inletOn ? 'ON ●' : 'OFF ○'}`);
        this._pumpText.fill(lc.inletOn ? C.blue : C.textDim);
        this._drainText.text(`排水泵:  ${lc.drainOn ? 'ON ●' : 'OFF ○'}`);
        this._drainText.fill(lc.drainOn ? C.orange : C.textDim);

        if (lc.level >= lc.setHH) { this._lvAlarmText.text('⚠ HH 高高液位报警'); this._lvAlarmText.fill(C.red); }
        else if (lc.level <= lc.setLL) { this._lvAlarmText.text('⚠ LL 低低液位报警'); this._lvAlarmText.fill(C.red); }
        else if (lc.level >= lc.setH) { this._lvAlarmText.text('△ H  高液位'); this._lvAlarmText.fill(C.yellow); }
        else if (lc.level <= lc.setL) { this._lvAlarmText.text('△ L  低液位'); this._lvAlarmText.fill(C.yellow); }
        else { this._lvAlarmText.text('● 液位正常'); this._lvAlarmText.fill(C.green); }

        if (this._levelTrendHistory.length > 1) {
            const m = this._lvTrendMeta, pts = [];
            this._levelTrendHistory.forEach((v, i) => {
                pts.push(m.x + i * (m.w / 350), m.y + m.h - (v / 100) * m.h);
            });
            this._lvTrendLine.points(pts);
        }
    }

    //---页面8---温度控制

    _renderTempPage() {
        const tc = this.tempCtrl;
        const maxT = 120, thH = 210, thY = 24;

        const fillH = Math.round(Math.min(1, tc.pv / maxT) * (thH - 4));
        this._thermFill.y(thY + thH - 2 - fillH);
        this._thermFill.height(fillH);
        const tc_ = tc.pv > 80 ? C.red : (tc.pv > 50 ? C.yellow : C.blue);
        this._thermFill.fill(tc_ + '99');
        this._pvLabel.text(`${tc.pv.toFixed(1)}°C`);
        this._pvLabel.fill(tc_);

        this._tempDisp.pv.text(`${tc.pv.toFixed(1)} °C`);
        this._tempDisp.sv.text(`${tc.sv.toFixed(1)} °C`);
        this._tempDisp.out.text(`${tc.out.toFixed(1)} %`);

        const htOn = tc.out > 50;
        const clOn = tc.out < 20;
        this._heaterBox.fill(htOn ? '#3a0000' : '#1a0000');
        this._heaterTxt.text(htOn ? (this.flashState ? '■ ON ' : '□ ON ') : ' OFF ');
        this._heaterTxt.fill(htOn ? C.red : C.textDim);
        this._coolerBox.fill(clOn ? '#001533' : '#000e1a');
        this._coolerTxt.text(clOn ? (this.flashState ? '■ ON ' : '□ ON ') : ' OFF ');
        this._coolerTxt.fill(clOn ? C.blue : C.textDim);

        if (tc.history.length > 1) {
            const m = this._tempTrendMeta, pts_pv = [], pts_sv = [], pts_out = [];
            tc.history.forEach((d, i) => {
                const x = m.x + i * (m.w / tc.maxHist);
                pts_pv.push(x, m.y + m.h - (d.pv / maxT) * m.h);
                pts_sv.push(x, m.y + m.h - (d.sv / maxT) * m.h);
                pts_out.push(x, m.y + m.h - (d.out / 100) * m.h);
            });
            this._tPV.points(pts_pv);
            this._tSV.points(pts_sv);
            this._tOUT.points(pts_out);
        }
    }




    // ══════════════════════════════════════════
    //  UI 辅助
    // ══════════════════════════════════════════
    /**
     * 创建标准按钮
     * 
     * 工厂方法，用于生成风格统一的矩形按钮。
     * 按钮宽度根据文字长度自动计算，背景采用半透明填充。
     * 
     * @param {Konva.Group|Konva.Layer} parent - 父容器，按钮将被添加到此容器中
     * @param {string} txt - 按钮显示的文字
     * @param {number} x - 按钮左上角 X 坐标
     * @param {number} y - 按钮左上角 Y 坐标
     * @param {string} color - 按钮的主题颜色（用于边框和文字）
     * @returns {Konva.Group} 返回按钮组对象，以便后续绑定事件
     */
    _mkBtn(parent, txt, x, y, color) {
        // 1. 创建按钮容器组
        // 设置坐标和鼠标悬停样式（手型指针），提升交互体验
        const g = new Konva.Group({ x, y, cursor: 'pointer' });
        // 2. 计算按钮宽度
        // 估算宽度：字符数 * 7px (等宽字体大约宽度) + 16px (左右内边距)        
        const w = txt.length * 7 + 16;
        // 3. 添加背景矩形
        // fill: color + '22' -> 在颜色代码后追加 '22' (十六进制透明度)，实现半透明背景效果
        // stroke: color -> 使用实色边框        
        g.add(new Konva.Rect({ width: w, height: 22, fill: color + '22', stroke: color, strokeWidth: 1, cornerRadius: 3 }));
        // 4. 添加文字标签
        // 文字覆盖在背景之上，居中对齐        
        g.add(new Konva.Text({ width: w, height: 22, text: txt, align: 'center', verticalAlign: 'middle', fontSize: 9, fontFamily: 'Courier New', fill: color, fontStyle: 'bold' }));
        // 5. 添加到父容器并返回
        parent.add(g);
        return g;// 返回 Group 引用，调用者可以链式调用 .on('click', ...)
    }

    _mkToggle(parent, txt, x, y, w, h, active, color) {
        const g = new Konva.Group({ x, y, cursor: 'pointer' });
        g.add(new Konva.Rect({ width: w, height: h, fill: active ? color + '33' : color + '22', stroke: color, strokeWidth: 1, cornerRadius: 3 }));
        g.add(new Konva.Text({ width: w, height: h, text: txt, align: 'center', verticalAlign: 'middle', fontSize: 9, fontFamily: 'Courier New', fill: color, fontStyle: 'bold' }));
        parent.add(g);
        return g;
    }

    // 打开范围（上限/下限/单位）编辑对话框
    _openRangeEditor(chId, refs) {
        const ai = this.sys.comps['ai'];
        if (!ai) return;
        const range = ai.ranges && ai.ranges[chId] ? ai.ranges[chId] : { urv: 0, lrv: 0, unit: '%' };

        const modal = document.createElement('div');
        modal.style = `position: fixed; left:0; top:0; right:0; bottom:0; background: rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:10000;`;
        const box = document.createElement('div');
        box.style = `background:#fff; padding:16px; border-radius:6px; width:320px; font-family: sans-serif;`;
        box.innerHTML = `<h3 style="margin:0 0 8px 0">编辑 ${chId} 量程与单位</h3>`;

        const urvRow = document.createElement('div');
        urvRow.style = 'margin-bottom:8px;';
        urvRow.innerHTML = `<label style="display:block;font-size:12px;color:#333">上限</label><input id="_urv" style="width:100%;padding:8px;box-sizing:border-box" value="${range.urv}">`;
        const lrvRow = document.createElement('div');
        lrvRow.style = 'margin-bottom:8px;';
        lrvRow.innerHTML = `<label style="display:block;font-size:12px;color:#333">下限</label><input id="_lrv" style="width:100%;padding:8px;box-sizing:border-box" value="${range.lrv}">`;
        const unitRow = document.createElement('div');
        unitRow.style = 'margin-bottom:8px;';
        const units = ['%', 'MPa', 'bar', '°C', 'cm', 'L/min'];
        unitRow.innerHTML = `<label style="display:block;font-size:12px;color:#333">单位</label><select id="_unit" style="width:100%;padding:8px;box-sizing:border-box">${units.map(u => `<option value="${u}" ${u === range.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>`;

        const btnRow = document.createElement('div'); btnRow.style = 'text-align:right; margin-top:10px;';
        const cancel = document.createElement('button'); cancel.innerText = '取消'; cancel.style = 'margin-right:8px;padding:6px 10px';
        const save = document.createElement('button'); save.innerText = '保存'; save.style = 'padding:6px 10px; background:#1395eb;color:#fff;border:none;border-radius:4px';
        btnRow.appendChild(cancel); btnRow.appendChild(save);

        box.appendChild(urvRow); box.appendChild(lrvRow); box.appendChild(unitRow); box.appendChild(btnRow);
        modal.appendChild(box);
        this.sys.container.appendChild(modal);

        cancel.onclick = () => modal.remove();
        save.onclick = () => {
            const urv = parseFloat(document.getElementById('_urv').value);
            const lrv = parseFloat(document.getElementById('_lrv').value);
            const unit = document.getElementById('_unit').value;
            if (isNaN(urv) || isNaN(lrv)) return alert('请输入有效的数字');
            // 通过 CAN 发送自定义写量程命令 0x0B
            const unitMap = { 'MPa': 1, 'bar': 2, '°C': 3, 'cm': 4, 'L/min': 5, '%': 6 };
            const unitCode = unitMap[unit] || 0;
            const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
            const chIdx = chKeys.indexOf(chId);
            const urvRaw = Math.round(urv * 100) & 0xFFFF;
            const lrvRaw = Math.round(lrv * 100) & 0xFFFF;
            const data = [0x0B, chIdx & 0xFF, (urvRaw >> 8) & 0xFF, urvRaw & 0xFF, (lrvRaw >> 8) & 0xFF, lrvRaw & 0xFF, unitCode & 0xFF, 0];
            try {
                this.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data, sender: this.id, timestamp: Date.now() });
                // 请求回读以刷新显示
                setTimeout(() => this._requestNodeConfig('ai', 0x09, chIdx), 80);
            } catch (e) { console.warn(e); }
            modal.remove();
        };
    }

    // 打开报警阈值编辑对话框（HH,H,L,LL）
    _openAlarmEditor(chId) {
        const ai = this.sys.comps['ai'];
        if (!ai) return;
        const alarms = ai.alarms && ai.alarms[chId] ? ai.alarms[chId] : { hh: 0, h: 0, l: 0, ll: 0 };

        const modal = document.createElement('div');
        modal.style = `position: fixed; left:0; top:0; right:0; bottom:0; background: rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:10000;`;
        const box = document.createElement('div');
        box.style = `background:#fff; padding:16px; border-radius:6px; width:360px; font-family: sans-serif;`;
        box.innerHTML = `<h3 style="margin:0 0 8px 0">编辑 ${chId} 报警阈值</h3>`;

        const mk = (label, id, val) => {
            const row = document.createElement('div'); row.style = 'margin-bottom:8px;';
            row.innerHTML = `<label style="display:block;font-size:12px;color:#333">${label}</label><input id="${id}" style="width:100%;padding:8px;box-sizing:border-box" value="${val}">`;
            return row;
        };

        const hhR = mk('HH', '_hh', alarms.hh);
        const hR = mk('H', '_h', alarms.h);
        const lR = mk('L', '_l', alarms.l);
        const llR = mk('LL', '_ll', alarms.ll);

        const btnRow = document.createElement('div'); btnRow.style = 'text-align:right; margin-top:10px;';
        const cancel = document.createElement('button'); cancel.innerText = '取消'; cancel.style = 'margin-right:8px;padding:6px 10px';
        const save = document.createElement('button'); save.innerText = '保存'; save.style = 'padding:6px 10px; background:#1395eb;color:#fff;border:none;border-radius:4px';
        btnRow.appendChild(cancel); btnRow.appendChild(save);

        box.appendChild(hhR); box.appendChild(hR); box.appendChild(lR); box.appendChild(llR); box.appendChild(btnRow);
        modal.appendChild(box);
        this.sys.container.appendChild(modal);

        cancel.onclick = () => modal.remove();
        save.onclick = () => {
            const hh = parseFloat(document.getElementById('_hh').value);
            const h = parseFloat(document.getElementById('_h').value);
            const l = parseFloat(document.getElementById('_l').value);
            const ll = parseFloat(document.getElementById('_ll').value);
            if ([hh, h, l, ll].some(v => isNaN(v))) return alert('请输入有效数字');
            const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
            const chIdx = chKeys.indexOf(chId);
            // 发送 0x03 (HH,LL)
            const hhRaw = Math.round(hh * 10) & 0xFFFF;
            const llRaw = Math.round(ll * 10) & 0xFFFF;
            const data1 = [0x03, chIdx & 0xFF, (hhRaw >> 8) & 0xFF, hhRaw & 0xFF, (llRaw >> 8) & 0xFF, llRaw & 0xFF, 0, 0];
            // 发送 0x04 (H,L)
            const hRaw = Math.round(h * 10) & 0xFFFF;
            const lRaw = Math.round(l * 10) & 0xFFFF;
            const data2 = [0x04, chIdx & 0xFF, (hRaw >> 8) & 0xFF, hRaw & 0xFF, (lRaw >> 8) & 0xFF, lRaw & 0xFF, 0, 0];
            try {
                this.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data: data1, sender: this.id, timestamp: Date.now() });
                setTimeout(() => this.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data: data2, sender: this.id, timestamp: Date.now() }), 30);
                // 请求回读以刷新显示
                setTimeout(() => { this._requestNodeConfig('ai', 0x07, chIdx); this._requestNodeConfig('ai', 0x08, chIdx); }, 120);
            } catch (e) { console.warn(e); }
            modal.remove();
        };
    }

    // 从 AI 模块读取并更新某行 UI
    _updateAIRowFromModule(chId) {
        const ai = this.sys.comps['ai'];
        if (!this._aiRows || !this._aiRows[chId]) return;
        const row = this._aiRows[chId];

        // 优先使用 this.data.ai（由 CAN 回复填充），回退到本地 AI 模块内存
        const cached = this.data && this.data.ai && this.data.ai[chId] ? this.data.ai[chId] : {};
        const ch = (cached && (cached.value !== undefined || cached.mode !== undefined)) ? cached : (ai && ai.channels && ai.channels[chId] ? ai.channels[chId] : { value: 0, mode: 'normal' });

        const rng = (cached && cached.ranges) ? cached.ranges : (ai && ai.ranges && ai.ranges[chId] ? ai.ranges[chId] : { urv: '--', lrv: '--', unit: '--' });
        const alm = (cached && cached.alarms) ? cached.alarms : (ai && ai.alarms && ai.alarms[chId] ? ai.alarms[chId] : { hh: '--', h: '--', l: '--', ll: '--' });

        // 量程显示
        row.rangeText && row.rangeText.text && row.rangeText.text(`量程: ${rng.lrv} ~ ${rng.urv} ${rng.unit || ''}`);
        // 模式显示
        const mode = (ch.mode || (ai && ai.channels && ai.channels[chId] && ai.channels[chId].mode) || 'normal');
        if (row.modeTxt) {
            row.modeTxt.text(`Mode: ${mode}`);
            if (mode === 'normal') row.modeTxt.fill(C.green);
            else if (mode === 'test') row.modeTxt.fill(C.orange);
            else row.modeTxt.fill(C.textDim);
        }
        // 工程量
        if (row.valDisplay) row.valDisplay.text((ch.value === undefined || ch.value === null) ? '---' : String(ch.value));
        // 上下限与单位
        row.urvText && row.urvText.text && row.urvText.text(`上限: ${rng.urv}`);
        row.lrvText && row.lrvText.text && row.lrvText.text(`下限: ${rng.lrv}`);
        row.unitText && row.unitText.text && row.unitText.text(`单位: ${rng.unit}`);
        // 报警
        row.hhText && row.hhText.text && row.hhText.text(`HH: ${alm.hh}`);
        row.hText && row.hText.text && row.hText.text(`H: ${alm.h}`);
        row.lText && row.lText.text && row.lText.text(`L: ${alm.l}`);
        row.llText && row.llText.text && row.llText.text(`LL: ${alm.ll}`);
        this._refreshCache();
    }

    // ══════════════════════════════════════════
    //  公开 API
    // ══════════════════════════════════════════
    update(newData) {
        if (!newData) return;
        if (newData.ai) Object.assign(this.data.ai, newData.ai);
        if (newData.ao) Object.assign(this.data.ao, newData.ao);
        if (newData.di) Object.assign(this.data.di, newData.di);
        if (newData.do) Object.assign(this.data.do, newData.do);
    }

    showPage(idx) { this._switchPage(idx); }

    destroy() {
        if (this._loopTimer) clearInterval(this._loopTimer);
        if (this._flashTimer) clearInterval(this._flashTimer);
        super.destroy && super.destroy();
    }
}