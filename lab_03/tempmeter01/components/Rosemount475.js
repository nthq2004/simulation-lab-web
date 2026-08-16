/**
 * Rosemount475.js
 * 罗斯蒙特 475 现场手操器仿真组件
 *
 * 功能：
 *   - 彩色 LCD 仿真界面（HART 菜单树）
 *   - 通过电路节点检测已连接的 SmartPressTransmitter
 *   - 支持 HART 命令：读取设备信息、过程变量、写入量程、调零、固定电流等
 *   - 菜单导航（上下左右 + OK/BACK 按键）
 *   - 在线编辑：LRV/URV/阻尼/Tag
 *   - 两线制接线（LOOP+ / LOOP-），并联接入 4-20mA 回路
 *   - 高输入阻抗（250Ω 模拟），不影响回路电流
 */
import { BaseComponent } from './BaseComponent.js';

// ── 菜单树定义 ─────────────────────────────────────────────────────────────
// 每个节点：{ label, type: 'menu'|'action'|'edit'|'view', children?, action?, key? }
function buildMenuTree() {
    return [
        {
            label: '1. 设备信息', type: 'menu', children: [
                { label: '1.1 位号 (Tag)', type: 'view', key: 'tag' },
                { label: '1.2 制造商', type: 'view', key: 'mfr' },
                { label: '1.3 型号', type: 'view', key: 'model' },
                { label: '1.4 序列号', type: 'view', key: 'serial' },
                { label: '1.5 固件版本', type: 'view', key: 'firmware' },
                { label: '1.6 轮询地址', type: 'view', key: 'address' },
            ]
        },
        {
            label: '2. 过程变量', type: 'menu', children: [
                { label: '2.1 PV 一次变量', type: 'view', key: 'pv' },
                { label: '2.2 AO 模拟输出', type: 'view', key: 'ao' },
                { label: '2.3 量程百分比', type: 'view', key: 'pct' },
                { label: '2.4 壳体温度 TV', type: 'view', key: 'tv' },
                { label: '2.5 设备状态', type: 'view', key: 'status' },
            ]
        },
        {
            label: '3. 组态', type: 'menu', children: [
                {
                    label: '3.1 量程配置', type: 'menu', children: [
                        { label: '3.1.1 设置 LRV', type: 'edit', key: 'min', cmd: 35 },
                        { label: '3.1.2 设置 URV', type: 'edit', key: 'max', cmd: 35 },
                        { label: '3.1.3 写入量程', type: 'action', cmd: 35 },
                        { label: '3.1.4 本地调零', type: 'action', cmd: 43 },
                    ]
                },
                {
                    label: '3.2 输出设置', type: 'menu', children: [
                        { label: '3.2.1 阻尼时间', type: 'edit', key: 'damping', cmd: 35 },
                        { label: '3.2.2 固定电流', type: 'edit', key: 'fixedMA', cmd: 40 },
                        { label: '3.2.3 进入固定模式', type: 'action', cmd: 40, arg: 'enter' },
                        { label: '3.2.4 退出固定模式', type: 'action', cmd: 40, arg: 'exit' },
                    ]
                },
                {
                    label: '3.3 标识符', type: 'menu', children: [
                        { label: '3.3.1 修改 Tag', type: 'edit', key: 'tag', cmd: 18 },
                        { label: '3.3.2 修改描述', type: 'edit', key: 'desc', cmd: 17 },
                        { label: '3.3.3 清除组态标志', type: 'action', cmd: 38 },
                    ]
                }
            ]
        },
        {
            label: '4. 诊断', type: 'menu', children: [
                { label: '4.1 设备状态', type: 'view', key: 'diagStatus' },
                { label: '4.2 组态变更', type: 'view', key: 'cfgChanged' },
                { label: '4.3 循环测试', type: 'action', cmd: 40, arg: 'loop4' },
                { label: '4.4 满量程输出', type: 'action', cmd: 40, arg: 'loop20' },
                { label: '4.5 退出回路', type: 'action', cmd: 40, arg: 'exit' },
            ]
        },
    ];
}

export class Rosemount475 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'hart_communicator';
        this.cache = 'fixed';
        this.scale = 1.5;

        // ── 外形尺寸（参照 475 实物比例） ──────────────────────────────
        this.W = 210 ;
        this.H = 340 ;
        this.width = this.W ;
        this.height = this.H ;

        // ── 连接状态 ─────────────────────────────────────────────────────
        this._connectedDev = null;   // 当前通过回路连接的智能变送器实例
        this._loopVoltage = 0;      // 当前回路电压（检测用）

        // ── 菜单导航状态 ─────────────────────────────────────────────────
        this._menuTree = buildMenuTree();
        this._navStack = [];         // 导航栈 [{items, cursor}]
        this._topItems = this._menuTree;
        this._cursor = 0;
        this._editMode = false;      // 是否处于编辑输入模式
        this._editBuf = '';         // 编辑缓冲区
        this._editNode = null;       // 当前编辑节点
        this._msgText = '';         // 底部消息栏
        this._msgTimer = null;

        // ── 设备电源 ─────────────────────────────────────────────────────
        this.isPowered = true;

        // ── 编辑暂存值（用于 Cmd 35 批量写入） ──────────────────────────
        this._editCache = {};

        // ── 构建 UI ──────────────────────────────────────────────────────
        this._buildUI();

        // ── 接线端口（并联接入 4-20mA 回路，LOOP+ / LOOP-）──────────────
        this.addPort(this.W*this.scale * 0.35, this.H*this.scale - 12, 'loopP', 'wire', 'p');
        this.addPort(this.W*this.scale * 0.65, this.H*this.scale - 12, 'loopN', 'wire');

        // 初始渲染
        this._renderScreen();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  UI 构建
    // ═══════════════════════════════════════════════════════════════════════
    _buildUI() {
        this.sg = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.sg);

        const W = this.W, H = this.H;

        // ── 外壳（Rosemount 475 黄灰配色） ──────────────────────────────
        const body = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#c8c0a8', stroke: '#8a8070',
            strokeWidth: 3, cornerRadius: 14,
            shadowBlur: 12, shadowColor: '#000', shadowOpacity: 0.5
        });
        // 品牌条（深灰）
        const topBar = new Konva.Rect({
            x: 3, y: 3, width: W - 6, height: 30,
            fill: '#3d3d3d', cornerRadius: [11, 11, 0, 0]
        });
        const brand = new Konva.Text({
            x: 0, y: 8, width: W,
            text: 'ROSEMOUNT  475', fontSize: 11,
            fontFamily: 'Arial Black, sans-serif', fontStyle: 'bold',
            fill: '#f5a623', align: 'center'
        });
        const sub = new Konva.Text({
            x: 0, y: 21, width: W,
            text: 'Field Communicator', fontSize: 7,
            fill: '#aaa', align: 'center'
        });

        this.sg.add(body, topBar, brand, sub);

        // ── LCD 屏幕区域 ──────────────────────────────────────────────────
        const LCD_X = 8, LCD_Y = 36, LCD_W = W - 16, LCD_H = 136;
        const lcdFrame = new Konva.Rect({
            x: LCD_X - 2, y: LCD_Y - 2,
            width: LCD_W + 4, height: LCD_H + 4,
            fill: '#222', stroke: '#111', strokeWidth: 2, cornerRadius: 3
        });
        this.lcdBg = new Konva.Rect({
            x: LCD_X, y: LCD_Y,
            width: LCD_W, height: LCD_H,
            fill: '#a8c060'   // 默认液晶绿
        });
        this.sg.add(lcdFrame, this.lcdBg);

        // LCD 内容由 Konva.Text 节点组成（6行）
        this._lcdLines = [];
        for (let i = 0; i < 6; i++) {
            const t = new Konva.Text({
                x: LCD_X + 3, y: LCD_Y + 3 + i * 21,
                width: LCD_W - 6, text: '',
                fontSize: 12, fontFamily: 'Courier New, monospace',
                fill: '#1a3010', align: 'left', wrap: 'none'
            });
            this._lcdLines.push(t);
            this.sg.add(t);
        }

        // 光标高亮条（当前选中行）
        this._lcdCursor = new Konva.Rect({
            x: LCD_X, y: LCD_Y + 3,
            width: LCD_W, height: 20,
            fill: '#2c6e1a', opacity: 0.35
        });
        this.sg.add(this._lcdCursor);

        // 消息栏（最底行）
        this._msgLine = new Konva.Text({
            x: LCD_X + 3, y: LCD_Y + LCD_H - 18,
            width: LCD_W - 6, text: '',
            fontSize: 9, fontFamily: 'Arial, sans-serif',
            fill: '#c0392b', align: 'center'
        });
        this.sg.add(this._msgLine);

        // ── 连接状态指示灯 ────────────────────────────────────────────────
        this._connLed = new Konva.Circle({
            x: W - 16, y: LCD_Y + 10, radius: 5,
            fill: '#555'
        });
        this._connLabel = new Konva.Text({
            x: 0, y: LCD_Y + 175,
            width: W, text: '未连接', fontSize: 8,
            fill: '#888', align: 'center'
        });
        this.sg.add(this._connLed, this._connLabel);

        // ── 按键区域 ──────────────────────────────────────────────────────
        this._buildButtons(W, LCD_Y + LCD_H + 6);

        // ── 底部接线标签 ──────────────────────────────────────────────────
        const jackLblP = new Konva.Text({ x: W * 0.35 - 14, y: H - 28, width: 28, text: 'LOOP+', fontSize: 7, fill: '#c00', align: 'center' });
        const jackLblN = new Konva.Text({ x: W * 0.65 - 14, y: H - 28, width: 28, text: 'LOOP-', fontSize: 7, fill: '#333', align: 'center' });
        this.sg.add(jackLblP, jackLblN);
    }

    _buildButtons(W, startY) {
        // 布局：
        //   行1(导航): [◄ LEFT] [▲ UP] [▼ DOWN] [► RIGHT]
        //   行2(操作): [BACK]  [OK/SEND]  [HOME]
        //   行3(数字): [1][2][3][4][5]
        //   行4(数字): [6][7][8][9][0]
        //   行5(功能): [.][+/-][DEL][CLR]

        const GAP = 4;
        const NAV_BW = (W - 5 * GAP) / 4;
        const NAV_BH = 22;
        const ACT_BW = (W - 4 * GAP) / 3;
        const NUM_BW = (W - 6 * GAP) / 5;
        const NUM_BH = 20;
        const FN_BW = (W - 5 * GAP) / 4;

        const btnStyle = (fill, tc) => ({ fill, tc });

        const navBtns = [
            { label: '◄', action: 'LEFT', ...btnStyle('#5d7c9e', '#fff') },
            { label: '▲', action: 'UP', ...btnStyle('#5d7c9e', '#fff') },
            { label: '▼', action: 'DOWN', ...btnStyle('#5d7c9e', '#fff') },
            { label: '►', action: 'RIGHT', ...btnStyle('#5d7c9e', '#fff') },
        ];
        const actBtns = [
            { label: 'BACK', action: 'BACK', ...btnStyle('#7f6b4a', '#fff') },
            { label: '  OK  ', action: 'OK', ...btnStyle('#2c7a2c', '#fff') },
            { label: 'HOME', action: 'HOME', ...btnStyle('#7f6b4a', '#fff') },
        ];
        const numBtns = [
            ['1', '2', '3', '4', '5'],
            ['6', '7', '8', '9', '0'],
        ];
        const fnBtns = [
            { label: '  .  ', action: 'NUM_DOT', ...btnStyle('#555', '#fff') },
            { label: ' +/- ', action: 'NUM_NEG', ...btnStyle('#555', '#fff') },
            { label: ' DEL ', action: 'NUM_DEL', ...btnStyle('#7a3a3a', '#fff') },
            { label: ' CLR ', action: 'NUM_CLR', ...btnStyle('#7a3a3a', '#fff') },
        ];

        let y = startY + 4;

        // 导航行
        navBtns.forEach((b, i) => {
            const x = GAP + i * (NAV_BW + GAP);
            this._addBtn(x, y, NAV_BW, NAV_BH, b.label, b.fill, b.tc, b.action, 13);
        });
        y += NAV_BH + GAP;

        // 操作行
        actBtns.forEach((b, i) => {
            const x = GAP + i * (ACT_BW + GAP);
            this._addBtn(x, y, ACT_BW, NAV_BH, b.label, b.fill, b.tc, b.action, 9);
        });
        y += NAV_BH + GAP;

        // 数字行
        numBtns.forEach(row => {
            row.forEach((d, i) => {
                const x = GAP + i * (NUM_BW + GAP);
                this._addBtn(x, y, NUM_BW, NUM_BH, d, '#3a3a3a', '#fff', `NUM_${d}`, 11);
            });
            y += NUM_BH + GAP;
        });

        // 功能行
        fnBtns.forEach((b, i) => {
            const x = GAP + i * (FN_BW + GAP);
            this._addBtn(x, y, FN_BW, NUM_BH, b.label, b.fill, b.tc, b.action, 9);
        });
    }

    _addBtn(x, y, w, h, label, fill, tc, action, fontSize) {
        const rect = new Konva.Rect({
            x, y, width: w, height: h,
            fill, stroke: '#222', strokeWidth: 1,
            cornerRadius: 3,
            shadowBlur: 2, shadowColor: '#000', shadowOpacity: 0.4
        });
        const txt = new Konva.Text({
            x, y: y + (h - fontSize * 1.2) / 2,
            width: w, text: label,
            fontSize, fontFamily: 'Arial, sans-serif',
            fill: tc, align: 'center'
        });
        const handler = (e) => {
            e.cancelBubble = true;
            this._handleKey(action);
            Promise.resolve().then(() => {
                rect.fill(this._brighten(fill));
                this._refreshCache();
                setTimeout(() => { rect.fill(fill); this._refreshCache(); }, 80);
            });
        };
        rect.on('mousedown touchstart', handler);
        txt.on('mousedown touchstart', handler);
        rect.on('dblclick', e => e.cancelBubble = true);
        this.sg.add(rect, txt);
    }

    _brighten(hex) {
        try {
            const n = parseInt(hex.replace('#', ''), 16);
            const r = Math.min(255, ((n >> 16) & 0xff) + 60);
            const g = Math.min(255, ((n >> 8) & 0xff) + 60);
            const b = Math.min(255, (n & 0xff) + 60);
            return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        } catch { return hex; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  按键处理
    // ═══════════════════════════════════════════════════════════════════════
    _handleKey(action) {
        if (!this.isPowered) return;

        // ── 编辑模式 ────────────────────────────────────────────────────
        if (this._editMode) {
            if (action.startsWith('NUM_')) {
                const ch = action.slice(4);
                if (ch === 'DOT') { if (!this._editBuf.includes('.')) this._editBuf += '.'; }
                else if (ch === 'NEG') { this._editBuf = this._editBuf.startsWith('-') ? this._editBuf.slice(1) : '-' + this._editBuf; }
                else if (ch === 'DEL') { this._editBuf = this._editBuf.slice(0, -1); }
                else if (ch === 'CLR') { this._editBuf = ''; }
                else { this._editBuf += ch; }
                this._renderScreen();
                return;
            }
            if (action === 'OK') { this._commitEdit(); return; }
            if (action === 'BACK') { this._editMode = false; this._editBuf = ''; this._renderScreen(); return; }
            return;
        }

        // ── 菜单导航 ────────────────────────────────────────────────────
        const items = this._currentItems();
        switch (action) {
            case 'UP':
                this._cursor = Math.max(0, this._cursor - 1);
                break;
            case 'DOWN':
                this._cursor = Math.min(items.length - 1, this._cursor + 1);
                break;
            case 'OK':
            case 'RIGHT':
                this._enterItem(items[this._cursor]);
                break;
            case 'BACK':
            case 'LEFT':
                if (this._navStack.length > 0) {
                    const prev = this._navStack.pop();
                    this._cursor = prev.cursor;
                } else {
                    this._cursor = 0;
                }
                break;
            case 'HOME':
                this._navStack = [];
                this._cursor = 0;
                break;
        }
        this._renderScreen();
    }

    _currentItems() {
        if (this._navStack.length === 0) return this._topItems;
        return this._navStack[this._navStack.length - 1].items;
    }

    _enterItem(node) {
        if (!node) return;
        if (node.type === 'menu') {
            this._navStack.push({ items: node.children, cursor: this._cursor });
            this._cursor = 0;
        } else if (node.type === 'edit') {
            this._editMode = true;
            this._editNode = node;
            // 从已连接设备读取当前值作为初值
            const dev = this._connectedDev;
            let initVal = '';
            if (dev) {
                if (node.key === 'min') initVal = String(dev.min);
                else if (node.key === 'max') initVal = String(dev.max);
                else if (node.key === 'damping') initVal = String(dev.damping);
                else if (node.key === 'tag') initVal = dev.hartTag || '';
                else if (node.key === 'desc') initVal = dev.hartDesc || '';
                else if (node.key === 'fixedMA') initVal = String(dev._fixedCurrent || 4);
            }
            this._editBuf = initVal;
        } else if (node.type === 'view') {
            // 不进入，只刷新显示
        } else if (node.type === 'action') {
            this._execAction(node);
        }
        this._renderScreen();
    }

    _commitEdit() {
        const node = this._editNode;
        const dev = this._connectedDev;
        this._editMode = false;

        if (!dev) { this._showMsg('未连接设备'); this._renderScreen(); return; }

        const val = parseFloat(this._editBuf);
        let logLine = '';

        if (node.key === 'min') {
            if (!isNaN(val)) { this._editCache.min = val; logLine = `LRV 暂存: ${val} ${dev.unit}`; }
        } else if (node.key === 'max') {
            if (!isNaN(val)) { this._editCache.max = val; logLine = `URV 暂存: ${val} ${dev.unit}`; }
        } else if (node.key === 'damping') {
            if (!isNaN(val) && val >= 0 && val <= 32) {
                this._editCache.damping = val;
                logLine = `阻尼暂存: ${val}s`;
            }
        } else if (node.key === 'tag') {
            dev.hartTag = this._editBuf;
            dev._cfgChanged = true;
            logLine = `Tag 已写入: ${this._editBuf}`;
        } else if (node.key === 'desc') {
            dev.hartDesc = this._editBuf;
            logLine = `描述已写入: ${this._editBuf}`;
        } else if (node.key === 'fixedMA') {
            if (!isNaN(val) && val >= 3.5 && val <= 22) {
                dev._fixedCurrent = val;
                logLine = `固定电流暂存: ${val.toFixed(3)} mA`;
            }
        }

        if (logLine) this._showMsg(logLine);
        this._editBuf = '';
        this._editNode = null;
        this._renderScreen();
    }

    _execAction(node) {
        const dev = this._connectedDev;
        if (!dev) { this._showMsg('未连接设备！'); return; }

        switch (node.cmd) {
            case 35: {
                // 写入量程
                const newMin = this._editCache.min !== undefined ? this._editCache.min : dev.min;
                const newMax = this._editCache.max !== undefined ? this._editCache.max : dev.max;
                const newDamp = this._editCache.damping !== undefined ? this._editCache.damping : dev.damping;
                if (newMax <= newMin) { this._showMsg('URV 必须大于 LRV！'); return; }
                dev.min = newMin;
                dev.max = newMax;
                dev.damping = newDamp;
                dev.config.min = newMin;
                dev.config.max = newMax;
                dev.config.damping = newDamp;
                dev._cfgChanged = true;
                this._editCache = {};
                this._showMsg(`Cmd35: LRV=${newMin} URV=${newMax}  ✔`);
                break;
            }
            case 43:
                // 本地调零
                dev.zeroAdj = -dev.press;
                dev._cfgChanged = true;
                this._showMsg(`Cmd43: 调零完成 PV=${dev.press.toFixed(4)}  ✔`);
                break;
            case 40:
                if (node.arg === 'enter') {
                    dev._fixedCurrentMode = true;
                    this._showMsg(`Cmd40: 进入固定 ${dev._fixedCurrent.toFixed(3)}mA  ✔`);
                } else if (node.arg === 'exit') {
                    dev._fixedCurrentMode = false;
                    this._showMsg(`Cmd40: 退出固定电流模式  ✔`);
                } else if (node.arg === 'loop4') {
                    dev._fixedCurrentMode = true;
                    dev._fixedCurrent = 4.0;
                    this._showMsg('Cmd40: 固定 4.000 mA (0%)  ✔');
                } else if (node.arg === 'loop20') {
                    dev._fixedCurrentMode = true;
                    dev._fixedCurrent = 20.0;
                    this._showMsg('Cmd40: 固定 20.000 mA (100%)  ✔');
                }
                break;
            case 38:
                dev._cfgChanged = false;
                this._showMsg('Cmd38: 组态标志已清除  ✔');
                break;
            case 17:
                this._showMsg('Cmd17: 消息已写入  ✔');
                break;
            case 18:
                this._showMsg('Cmd18: 标签已写入  ✔');
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LCD 渲染
    // ═══════════════════════════════════════════════════════════════════════
    _renderScreen() {
        if (!this.isPowered) {
            this.lcdBg.fill('#111');
            this._lcdLines.forEach(l => l.text(''));
            this._lcdCursor.opacity(0);
            this._msgLine.text('');
            this._refreshCache();
            return;
        }

        this.lcdBg.fill('#a8c060');
        this._lcdCursor.opacity(0.35);

        // ── 编辑模式 ─────────────────────────────────────────────────────
        if (this._editMode) {
            this._renderEditMode();
            this._refreshCache();
            return;
        }

        // ── 菜单/视图模式 ────────────────────────────────────────────────
        const items = this._currentItems();
        const VISIBLE = 5;   // LCD 显示行数（留最后1行给消息）
        const start = Math.max(0, Math.min(this._cursor - 2, items.length - VISIBLE));

        // 标题行（路径）
        this._lcdLines[0].text(this._pathTitle());
        this._lcdLines[0].fill('#2c6e1a');
        this._lcdLines[0].fontStyle('bold');

        for (let i = 0; i < VISIBLE; i++) {
            const item = items[start + i];
            const line = this._lcdLines[i + 1];
            if (!item) { line.text(''); continue; }

            const isSelected = (start + i) === this._cursor;
            const prefix = isSelected ? '►' : ' ';
            const suffix = item.type === 'menu' ? ' ▷' : (item.type === 'edit' ? ' ✎' : '');

            if (item.type === 'view') {
                line.text(`${prefix} ${item.label}: ${this._getViewValue(item.key)}`);
            } else {
                line.text(`${prefix} ${item.label}${suffix}`);
            }
            line.fill(isSelected ? '#003300' : '#2c4a1a');
            line.fontStyle(isSelected ? 'bold' : 'normal');

            // 移动光标条到选中行
            if (isSelected) {
                this._lcdCursor.y(36 + 3 + (i + 1) * 21);
            }
        }

        // 消息行
        this._msgLine.text(this._msgText || this._connStatusText());
        this._refreshCache();
    }

    _renderEditMode() {
        const node = this._editNode;
        this._lcdLines[0].text('─── 编辑值 ───');
        this._lcdLines[0].fill('#1a4a3a');
        this._lcdLines[0].fontStyle('bold');
        this._lcdLines[1].text(node ? node.label : '');
        this._lcdLines[1].fill('#2c6e1a');
        this._lcdLines[1].fontStyle('normal');
        this._lcdLines[2].text('');
        this._lcdLines[3].text(`输入: ${this._editBuf}_`);
        this._lcdLines[3].fill('#003300');
        this._lcdLines[4].text('');
        this._lcdLines[5] && (this._lcdLines[5].text('OK=确认  BACK=取消'));
        this._msgLine.text('');
        this._lcdCursor.opacity(0);
    }

    _pathTitle() {
        if (this._navStack.length === 0) return '── 主菜单 ──';
        const stack = this._navStack;
        // 取最后两层标签
        const last = stack[stack.length - 1];
        return last.items === this._currentItems()
            ? (stack.length > 1 ? stack[stack.length - 2].items?.[stack[stack.length - 2].cursor]?.label?.substring(0, 16) || '── 子菜单 ──' : '── 子菜单 ──')
            : '── 子菜单 ──';
    }

    _getViewValue(key) {
        const dev = this._connectedDev;
        if (!dev) return '-- 未连接 --';
        switch (key) {
            case 'tag': return dev.hartTag || dev.id;
            case 'mfr': return dev.hartMfr || 'N/A';
            case 'model': return dev.hartModel || 'N/A';
            case 'serial': return dev.hartSerial || 'N/A';
            case 'firmware': return dev.hartFirmware || 'N/A';
            case 'address': return String(dev.hartAddress ?? 0);
            case 'pv': return `${dev.press?.toFixed(4) ?? '--'} ${dev.unit}`;
            case 'ao': return `${dev.ao?.toFixed(3) ?? '--'} mA`;
            case 'pct': return `${dev.pct?.toFixed(2) ?? '--'} %`;
            case 'tv': return `${dev.temp?.toFixed(1) ?? '--'} °C`;
            case 'status': return dev.isSat ? '⚠ 饱和/告警' : '✓ 正常';
            case 'diagStatus': return dev.isBreak ? '⚠ 开路' : (dev.isSat ? '⚠ 饱和' : '✓ OK');
            case 'cfgChanged': return dev._cfgChanged ? '⚠ 已变更' : '✓ 未变更';
            default: return 'N/A';
        }
    }

    _connStatusText() {
        if (!this._connectedDev) return '未连接 HART 设备';
        return `已连接: ${this._connectedDev.hartTag || this._connectedDev.id}`;
    }

    _showMsg(msg) {
        this._msgText = msg;
        if (this._msgTimer) clearTimeout(this._msgTimer);
        this._msgTimer = setTimeout(() => {
            this._msgText = '';
            this._renderScreen();
        }, 3000);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  update — 每帧由 InstrumentUpdater 或电路求解器调用
    //  检测通过回路接入的 SmartPressTransmitter
    // ═══════════════════════════════════════════════════════════════════════
    update(state) {
        // state 由外部仿真引擎传入，包含当前回路连接信息
        // 此处主要依靠 _scanConnectedDevice 在每帧扫描
        this._scanConnectedDevice();
        this._updateConnLed();
        this._renderScreen();
    }

    /**
     * 扫描当前通过 LOOP+/LOOP- 连接到同一节点的智能变送器
     * 策略：遍历所有设备，找到 type='transmitter_2wire' 且
     *       其 _wire_p / _wire_n 节点与本机 LOOP+/LOOP- 同簇的设备。
     */
    _scanConnectedDevice() {
        const s = this.sys;
        if (!s || !s.voltageSolver) return;

        const solver = s.voltageSolver;
        const ptc = solver.portToCluster;
        if (!ptc) return;

        const myP = ptc.get(`${this.id}_wire_loopP`);
        const myN = ptc.get(`${this.id}_wire_loopN`);
        if (myP === undefined || myN === undefined) {
            this._connectedDev = null;
            return;
        }

        // 查找匹配的智能变送器
        let found = null;
        const devs = Object.values(s.comps || {});
        for (const dev of devs) {
            if (dev.type !== 'transmitter_2wire') continue;
            const devP = ptc.get(`${dev.id}_wire_p`);
            const devN = ptc.get(`${dev.id}_wire_n`);
            // 同簇判定：要么 P 对 P，要么 P 对 N（极性可能反接）
            const connected =
                (myP !== undefined && (myP === devP || myP === devN)) ||
                (myN !== undefined && (myN === devP || myN === devN));
            if (connected && dev.hartTag !== undefined&&dev._lastVDiff>18) {
                found = dev;
                break;
            }
        }
        this._connectedDev = found;
    }

    _updateConnLed() {
        if (this._connectedDev) {
            this._connLed.fill('#00e676');
            this._connLabel.text(`HART: ${this._connectedDev.hartTag || this._connectedDev.id}`);
            this._connLabel.fill('#2c6e1a');
        } else {
            this._connLed.fill('#ff4757');
            this._connLabel.text('未连接 HART 设备');
            this._connLabel.fill('#888');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  配置字段
    // ═══════════════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '仪器位号', key: 'id', type: 'text' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id = newConfig.id || this.id;
        this.config = { ...newConfig };
    }
}
