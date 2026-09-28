/**
 * 重要配电装置（参照低压主配电板 LvSwitchPanel 的柜体画法）
 *  - 尺寸：高度 = 主配电板 × 2/5（813→325），宽度 = 主配电板 × 5/8（1800→1125），共 5 个屏
 *  - 屏 1 应急发电机机旁控制箱（界面参照 应急发电机组件 EmergencyGenerator3P）
 *  - 屏 2 应急配电板（界面参照 应急配电板组件 EmergencyPanel）
 *  - 屏 3 岸电箱（界面参照 岸电箱组件 ShorePowerBox）
 *  - 屏 4 重载问询面板（界面参照 重载询问组件 HeavyLoadInquiry）
 *  - 屏 5 应急风油切断控制屏：4 个自锁式方形按钮（按下自锁、再按弹出，带动画），
 *    按下时对主配电板中同铭牌标签的开关送“分励脱扣”，未弹出前这些开关无法合闸（合上即脱扣）
 *  - 无外部电气端口；与主配电板组件（lv_switch_panel）建立逻辑关联
 */
import { BaseComponent } from './BaseComponent.js';

const PW = 225;                        // 单屏宽度（与主配电板 CAB_W 一致）
const N = 5;                           // 屏数
const PH = Math.round(813 * 2 / 5);    // 高度 = 主配电板 2/5 → 325

const PANELS = ['应急发电机机旁控制箱', '应急配电板', '岸电箱', '重载问询面板', '应急风油切断控制屏'];

// 应急切断按钮 → 主配电板铭牌标签
const CUTOFF = [
    { label: '机舱风机', sub: '应急切断', tag: 'ESS-1F' },
    { label: '机舱油泵', sub: '应急切断', tag: 'ESS-1P' },
    { label: '住舱风机', sub: '应急切断', tag: 'ESS-2F' },
    { label: '泵房风机', sub: '应急切断', tag: 'ESS-3F' },
];

// ATS 阶段显示文字
const ATS_TXT = {
    idle: '待机', gen_start: '起动延时', gen_build: '建压', eqf_delay: '合闸延时',
    running: '应发供电', stop_delay: '延时停机', restore_tie: '联络闭合', restore_stop: '延时停机',
};

const GREEN = '#2eff3e', RING = '#c9ced4', RING_S = '#8a929c';
const LCD_BG = '#0a0a0a';

export class ImportantDistPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = PW * N;
        this.height = PH;
        this.type = 'important_dist_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._initState();
        this._init();

        this.config = {};
    }

    _initState() {
        // 屏 1 应急发电机
        this._egRun = false; this._egT = 0; this._egMode = 1;      // 0 手动 / 1 自动（默认自动）
        this._egAutoT = 0;                                          // 自动起动延时
        this._egGovHz = 0;                                          // 调速开关整定（Hz，右转 +0.1 / 左转 -0.1）
        this._egFault = false;                                      // 应急发电机故障
        // 屏 2 应急配电板
        this._epCtl = 1; this._epTest = 1;                        // 0 手动/试验 1 自动/正常（默认自动 / 正常）
        // 应急配电板自动转电（ATS）阶段机
        this._phase = 'idle';      // idle/tie_open/gen_start/gen_build/eqf_delay/running/restore_tie/restore_stop
        this._phaseT = 0;
        this._tieClosed = true;    // 联络开关合位（主电网供电）
        this._egfClosed = false;   // 应急主开关合位（应发供电）
        // 屏 3 岸电箱
        this._spOn = false; this._spKnob = 1;
        this._spSupply = true;                                     // 岸电箱进线电源（默认已送到岸电箱 → 电源灯亮白）                      // 0 相序1 / 1 OFF / 2 相序2
        this._seq1Correct = Math.random() < 0.5;                   // 相序1 是否为正序（每次重置随机；相序2 必与其相反）
        this._spSig = '';                                          // 推送主配电板岸电开关下端带电状态签名
        // 屏 4 重载询问
        this._hlPower = 500; this._hlRun = false; this._hlResp = 0; this._hlMode = 1;  // 0 直接起动 / 1 重载询问
        this._hlInquiry = false;   // 重载询问已发出，等待电站增容
        // 屏 5 应急切断
        this._pressed = [false, false, false, false];
        this._caps = []; this._sig = '';
    }

    _init() { this._drawStaticParts(); this._createDynamicNodes(); this._bindInteraction(); }

    // ── 通用绘图小件 ──
    _frame(i) {
        const s = this._staticGroup, x0 = i * PW;
        s.add(new Konva.Rect({ x: x0 + 2, y: 2, width: PW - 4, height: PH - 4, fill: '#e8ecef', stroke: '#4a5a66', strokeWidth: 1.5, cornerRadius: 2 }));
        s.add(new Konva.Text({ x: x0, y: 11, width: PW, align: 'center', text: PANELS[i], fontSize: 17, fontStyle: 'bold', fill: '#006400', listening: false }));
        s.add(new Konva.Line({ points: [x0 + 4, 34, x0 + PW - 4, 34], stroke: '#7a8494', strokeWidth: 1 }));
        if (i > 0) s.add(new Konva.Line({ points: [x0, 2, x0, PH - 2], stroke: '#2c3a45', strokeWidth: 3 }));
    }
    /** 带金属外圈的圆（指示灯 / 按钮底座） */
    _ring(x, y, r, cap) {
        const s = this._staticGroup;
        s.add(new Konva.Circle({ x, y, radius: r + 4, fill: RING, stroke: RING_S, strokeWidth: 1.2 }));
        s.add(new Konva.Circle({ x, y, radius: r, fill: cap, stroke: '#5a6068', strokeWidth: 1.2 }));
    }
    /** 黑色液晶框 */
    _lcd(x, y, w, h) {
        const s = this._staticGroup;
        s.add(new Konva.Rect({ x, y, width: w, height: h, fill: LCD_BG, stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 2 }));
    }
    /** 旋钮（灰底方框 + 黑色手柄） */
    _leverBox(x, y, w, h, fill) {
        const s = this._staticGroup;
        s.add(new Konva.Rect({ x, y, width: w, height: h, fill: fill || '#b9c0c7', stroke: '#6a737c', strokeWidth: 1.2, cornerRadius: 3 }));
    }

    _drawStaticParts() {
        for (let i = 0; i < N; i++) this._frame(i);
        const s = this._staticGroup;
        this._drawPanelEG();
        this._drawPanelEP();
        this._drawPanelSP();
        this._drawPanelHL();
        this._drawPanelCut();
    }

    // ── 屏 1：应急发电机（界面参照 EmergencyGenerator3P）──
    _drawPanelEG() {
        const s = this._staticGroup;
        this._lcd(12, 44, 201, 80);
        s.add(new Konva.Text({ x: 12, y: 132, width: 201, text: '控制方式', fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        this._leverBox(38, 148, 149, 40);
        s.add(new Konva.Text({ x: 44, y: 156, width: 50, text: '手动', fontSize: 13, fontStyle: 'bold', fill: '#1f9d33', align: 'left', listening: false }));
        s.add(new Konva.Text({ x: 130, y: 156, width: 50, text: '自动', fontSize: 13, fontStyle: 'bold', fill: '#1565c0', align: 'right', listening: false }));
        s.add(new Konva.Circle({ x: 112, y: 174, radius: 9, fill: '#2c3a45', stroke: '#1a252f', strokeWidth: 1 }));
        // 起动 / 停止 方按钮
        s.add(new Konva.Rect({ x: 20, y: 198, width: 96, height: 34, fill: '#2ecc40', stroke: '#1a7a28', strokeWidth: 1.5, cornerRadius: 4 }));
        s.add(new Konva.Circle({ x: 98, y: 215, radius: 5, fill: '#1a4d20', stroke: '#0d3a12', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: 20, y: 234, width: 96, text: '起动', fontSize: 13, fontStyle: 'bold', fill: '#1f9d33', align: 'center', listening: false }));
        s.add(new Konva.Rect({ x: 120, y: 198, width: 88, height: 34, fill: '#e0392b', stroke: '#8a1a12', strokeWidth: 1.5, cornerRadius: 4 }));
        s.add(new Konva.Circle({ x: 192, y: 215, radius: 5, fill: 'none', stroke: '#ffffff', strokeWidth: 1.5 }));
        s.add(new Konva.Text({ x: 120, y: 234, width: 88, text: '停止', fontSize: 13, fontStyle: 'bold', fill: '#c03020', align: 'center', listening: false }));
        // 调频旋钮
        this._ring(112, 282, 26, '#e6e9ec');
        s.add(new Konva.Circle({ x: 112, y: 282, radius: 9, fill: '#111', stroke: '#000', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: 12, y: 307, width: 201, text: '减速  ←   加速', fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
    }

    // ── 屏 2：应急配电板（界面参照 EmergencyPanel）──
    _drawPanelEP() {
        const s = this._staticGroup, x0 = PW;
        this._lcd(x0 + 10, 40, 205, 72);
        // 3 个方形指示灯
        [[40, '主电网有电'], [112, '应急备用'], [184, '应急运行']].forEach(([dx, txt]) => {
            s.add(new Konva.Rect({ x: x0 + dx - 12, y: 122, width: 24, height: 22, fill: '#d6dce1', stroke: '#6a737c', strokeWidth: 1.2, cornerRadius: 2 }));
            s.add(new Konva.Text({ x: x0 + dx - 34, y: 146, width: 68, text: txt, fontSize: 12, fill: '#1a252f', align: 'center', listening: false }));
        });
        // 控制模式
        s.add(new Konva.Text({ x: x0 + 10, y: 178, width: 90, text: '控制模式', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'left', listening: false }));
        this._leverBox(x0 + 10, 194, 76, 36, '#a8b0b8');
        s.add(new Konva.Text({ x: x0 + 14, y: 200, width: 34, text: '手动', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'left', listening: false }));
        s.add(new Konva.Text({ x: x0 + 44, y: 200, width: 38, text: '自动', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'right', listening: false }));
        s.add(new Konva.Circle({ x: x0 + 48, y: 216, radius: 8, fill: '#2c3a45', stroke: '#1a252f', strokeWidth: 1 }));
        // 应急主开关 合闸/分闸 按钮：金属外圈（钮帽为动态节点，随合/分闸状态变色）
        s.add(new Konva.Circle({ x: x0 + 128, y: 212, radius: 22, fill: RING, stroke: RING_S, strokeWidth: 1.2 }));
        s.add(new Konva.Circle({ x: x0 + 188, y: 212, radius: 22, fill: RING, stroke: RING_S, strokeWidth: 1.2 }));
        s.add(new Konva.Text({ x: x0 + 110, y: 234, width: 36, text: '合闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 170, y: 234, width: 36, text: '分闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        // 联络开关
        s.add(new Konva.Text({ x: x0 + 10, y: 252, width: 90, text: '联络开关', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'left', listening: false }));
        this._leverBox(x0 + 10, 268, 76, 36, '#c8ced4');
        s.add(new Konva.Text({ x: x0 + 14, y: 274, width: 34, text: '试验', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'left', listening: false }));
        s.add(new Konva.Text({ x: x0 + 44, y: 274, width: 38, text: '正常', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'right', listening: false }));
        s.add(new Konva.Circle({ x: x0 + 48, y: 290, radius: 8, fill: '#2c3a45', stroke: '#1a252f', strokeWidth: 1 }));
        // 联络合闸 / 联络分闸：指示灯（无外框，半径 13）
        s.add(new Konva.Text({ x: x0 + 104, y: 306, width: 48, text: '联络合闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 164, y: 306, width: 48, text: '联络分闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
    }

    // ── 屏 3：岸电箱（界面参照 ShorePowerBox）──
    _drawPanelSP() {
        const s = this._staticGroup, x0 = PW * 2;
        this._lcd(x0 + 8, 40, 209, 30);      // 与应急配电板一致的黑色液晶框
        // 3 只指示灯
        [[42, '电源'], [112, '正序'], [182, '负序']].forEach(([dx, txt]) => {
            this._ring(x0 + dx, 105, 13, '#3a4249');
            s.add(new Konva.Text({ x: x0 + dx - 34, y: 123, width: 68, text: txt, fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        });
        // 相序转换
        s.add(new Konva.Text({ x: x0 + 12, y: 152, width: 201, text: 'OFF', fontSize: 14, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 6, y: 176, width: 56, text: '相序1', fontSize: 13, fontStyle: 'bold', fill: '#1f9d33', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 163, y: 176, width: 56, text: '相序2', fontSize: 13, fontStyle: 'bold', fill: '#e07b20', align: 'center', listening: false }));
        this._ring(x0 + 112, 206, 30, '#e6e9ec');
        s.add(new Konva.Circle({ x: x0 + 112, y: 206, radius: 9, fill: '#2c3a45', stroke: '#1a252f', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: x0 + 12, y: 240, width: 201, text: '相序转换', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        // 合闸 / 分闸
        s.add(new Konva.Circle({ x: x0 + 66, y: 278, radius: 25, fill: RING, stroke: RING_S, strokeWidth: 1.2 }));
        s.add(new Konva.Circle({ x: x0 + 158, y: 278, radius: 25, fill: RING, stroke: RING_S, strokeWidth: 1.2 }));
        s.add(new Konva.Text({ x: x0 + 44, y: 300, width: 44, text: '合闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 136, y: 300, width: 44, text: '分闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
    }

    // ── 屏 4：重载问询面板（界面参照 HeavyLoadInquiry）──
    _drawPanelHL() {
        const s = this._staticGroup, x0 = PW * 3;
        s.add(new Konva.Text({ x: x0 + 6, y: 40, width: 213, text: '重载询问---侧推器', fontSize: 15, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 8, y: 71, width: 74, text: '功率(kW)', fontSize: 15, fontStyle: 'bold', fill: '#1a252f', align: 'left', listening: false }));
        s.add(new Konva.Rect({ x: x0 + 88, y: 64, width: 90, height: 26, fill: '#ffffff', stroke: '#6a737c', strokeWidth: 1.2, cornerRadius: 2 }));
        this._ring(x0 + 66, 128, 10, '#8a929c');
        this._ring(x0 + 160, 128, 10, '#8a929c');
        s.add(new Konva.Text({ x: x0 + 46, y: 143, width: 40, text: '运行', fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 140, y: 143, width: 40, text: '回应', fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        // 转换开关两个档位标签：各分两行显示（与开关左侧/右侧档位对应）
        s.add(new Konva.Text({ x: x0 - 1, y: 183, width: 58, text: '直接' + String.fromCharCode(10) + '起动', fontSize: 12, lineHeight: 1.15, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 46, y: 183, width: 58, text: '重载' + String.fromCharCode(10) + '问询', fontSize: 12, lineHeight: 1.15, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        this._ring(x0 + 54, 242, 26, '#e6e9ec');
        s.add(new Konva.Circle({ x: x0 + 54, y: 242, radius: 8, fill: '#000', stroke: '#000', strokeWidth: 1 }));
        s.add(new Konva.Rect({ x: x0 + 104, y: 196, width: 106, height: 32, fill: '#2e7d32', stroke: '#1a4d20', strokeWidth: 1.2, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: x0 + 104, y: 240, width: 106, height: 32, fill: '#c0392b', stroke: '#7a1a12', strokeWidth: 1.2, cornerRadius: 3 }));
        s.add(new Konva.Text({ x: x0 + 104, y: 205, width: 106, text: '起动 / 询问', fontSize: 15, fontStyle: 'bold', fill: '#ffffff', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: x0 + 104, y: 249, width: 106, text: '停  止', fontSize: 15, fontStyle: 'bold', fill: '#ffffff', align: 'center', listening: false }));
    }

    // ── 屏 5：应急风油切断控制屏 ──
    _drawPanelCut() {
        const s = this._staticGroup, cx0 = PW * 4;
        s.add(new Konva.Text({ x: cx0 + 8, y: 40, width: 209, text: '按下自锁 / 再按弹出', fontSize: 12, fill: '#5a6a75', align: 'center', listening: false }));
        CUTOFF.forEach((c, i) => {
            const cy = 82 + i * 62;
            s.add(new Konva.Text({ x: cx0 + 8, y: cy - 16, width: 78, text: c.label, fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cx0 + 8, y: cy + 1, width: 78, text: c.sub, fontSize: 12, fontStyle: 'bold', fill: '#c03020', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cx0 + 8, y: cy + 18, width: 78, text: c.tag, fontSize: 10, fill: '#5a6a75', align: 'center', listening: false }));
            s.add(new Konva.Rect({ x: cx0 + 100, y: cy - 24, width: 56, height: 48, fill: '#3a4249', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 4 }));
            s.add(new Konva.Rect({ x: cx0 + 104, y: cy - 20, width: 48, height: 40, fill: '#2a3138', stroke: '#151a1f', strokeWidth: 1, cornerRadius: 3 }));
        });
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        // ── 屏 1：应急发电机液晶 + 控制方式手柄 + 调频指针 ──
        this._egLcd = [];
        const egLines = [
            { x: 18, y: 50, w: 96, fill: GREEN, t: 'V —' }, { x: 118, y: 50, w: 90, fill: GREEN, t: 'F —' },
            { x: 18, y: 74, w: 96, fill: '#ffd400', t: 'I —' }, { x: 118, y: 74, w: 90, fill: '#ffd400', t: 'P —' },
            { x: 18, y: 98, w: 186, fill: '#4fc3f7', t: 'COS —' },
        ];
        egLines.forEach(L => {
            const n = new Konva.Text({ x: L.x, y: L.y, width: L.w, text: L.t, fontSize: 17, fontStyle: 'bold', fontFamily: 'Courier New', fill: L.fill, align: 'left', listening: false });
            d.add(n); this._egLcd.push(n);
        });
        this._egLever = new Konva.Group({ x: 112, y: 174, rotation: -28 });
        this._egLever.add(new Konva.Line({ points: [0, 0, 0, -22], stroke: '#111', strokeWidth: 6, lineCap: 'round' }));
        d.add(this._egLever);
        this._egGov = new Konva.Group({ x: 112, y: 282, rotation: 0 });
        this._egGov.add(new Konva.Line({ points: [0, 0, 0, -19], stroke: '#111', strokeWidth: 7, lineCap: 'round' }));
        d.add(this._egGov);
        this._egGovNode = this._egGov;

        // ── 屏 2：应急配电板液晶 + 3 个方形指示灯 + 2 个手柄 ──
        const x0 = PW;
        this._epLcd = [];
        ['主电  ——V', '应急  ——Hz   ——V', '手动-正常  待机'].forEach((t, i) => {
            const n = new Konva.Text({ x: x0 + 16, y: 46 + i * 22, width: 194, text: t, fontSize: 15, fontStyle: 'bold', fontFamily: 'Courier New', fill: GREEN, align: 'left', listening: false });
            d.add(n); this._epLcd.push(n);
        });
        this._epLamp = [];
        [40, 112, 184].forEach(dx => {
            const n = new Konva.Rect({ x: x0 + dx - 10, y: 124, width: 20, height: 18, fill: '#d6dce1', stroke: '#5a6068', strokeWidth: 1, cornerRadius: 2 });
            d.add(n); this._epLamp.push(n);
        });
        this._epLever = new Konva.Group({ x: x0 + 48, y: 216, rotation: 28 });
        this._epLever.add(new Konva.Line({ points: [0, 0, 0, -20], stroke: '#111', strokeWidth: 5, lineCap: 'round' }));
        d.add(this._epLever);
        this._epTie = new Konva.Group({ x: x0 + 48, y: 290, rotation: 28 });
        this._epTie.add(new Konva.Line({ points: [0, 0, 0, -20], stroke: '#111', strokeWidth: 5, lineCap: 'round' }));
        d.add(this._epTie);
        this._epBtn = [128, 188].map(dx => {         // 合闸 / 分闸 钮帽
            const n = new Konva.Circle({ x: x0 + dx, y: 212, radius: 18, fill: '#1e4d24', stroke: '#5a6068', strokeWidth: 1.2 });
            d.add(n);
            return n;
        });
        this._epTieLed = [128, 188].map(dx => {
            const n = new Konva.Circle({ x: x0 + dx, y: 286, radius: 13, fill: '#3a4249', stroke: '#2a3138', strokeWidth: 1.2 });
            d.add(n);
            return n;
        });

        // ── 屏 3：岸电箱液晶 + 3 只指示灯 + 相序转换旋钮 ──
        const sx = PW * 2;
        this._spLcd = new Konva.Text({ x: sx + 8, y: 47, width: 209, text: '---V, ---Hz', fontSize: 16, fontStyle: 'bold', fontFamily: 'Courier New', fill: GREEN, align: 'center', listening: false });
        d.add(this._spLcd);
        this._spLamp = [];
        [42, 112, 182].forEach(dx => {
            const n = new Konva.Circle({ x: sx + dx, y: 105, radius: 13, fill: '#3a4249', stroke: '#2a3138', strokeWidth: 1.2 });
            d.add(n); this._spLamp.push(n);
        });
        this._spBtn = [66, 158].map(dx => {              // 合闸 / 分闸 钮帽（随状态变色）
            const n = new Konva.Circle({ x: sx + dx, y: 278, radius: 21, fill: '#1e4d24', stroke: '#5a6068', strokeWidth: 1.2 });
            d.add(n);
            return n;
        });
        this._spKnobNode = new Konva.Group({ x: sx + 112, y: 206, rotation: 0 });
        this._spKnobNode.add(new Konva.Line({ points: [0, 0, 0, -22], stroke: '#111', strokeWidth: 7, lineCap: 'round' }));
        d.add(this._spKnobNode);

        // ── 屏 4：重载问询 功率值 + 运行/回应灯 + 模式旋钮 ──
        const hx = PW * 3;
        this._hlPowerText = new Konva.Text({ x: hx + 88, y: 69, width: 90, text: '500', fontSize: 15, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false });
        d.add(this._hlPowerText);
        this._hlRunLamp = new Konva.Circle({ x: hx + 66, y: 128, radius: 10, fill: '#8a929c', stroke: '#2a3138', strokeWidth: 1.2 });
        this._hlRespLamp = new Konva.Circle({ x: hx + 160, y: 128, radius: 10, fill: '#8a929c', stroke: '#2a3138', strokeWidth: 1.2 });
        d.add(this._hlRunLamp, this._hlRespLamp);
        this._hlKnob = new Konva.Group({ x: hx + 54, y: 242, rotation: 150 });
        this._hlKnob.add(new Konva.Line({ points: [0, 0, 0, -19], stroke: '#111', strokeWidth: 8, lineCap: 'round' }));
        d.add(this._hlKnob);

        // ── 屏 5：应急切断按钮帽 + 状态灯 ──
        const cx0 = PW * 4;
        this._caps = []; this._cutLed = [];
        CUTOFF.forEach((c, i) => {
            const cy = 82 + i * 62;
            const cap = new Konva.Rect({ x: cx0 + 105, y: cy - 19, width: 46, height: 38, fill: '#c02020', stroke: '#5a0000', strokeWidth: 1.5, cornerRadius: 3 });
            const led = new Konva.Circle({ x: cx0 + 186, y: cy, radius: 8, fill: '#2a2f34', stroke: '#1a252f', strokeWidth: 1.2 });
            d.add(cap, led);
            this._caps.push(cap); this._cutLed.push(led);
        });
    }

    /** 注册可识别部件（应急风油切断 4 个自锁按钮），点击即按下/弹出 */
    _registerParts() {
        const cx0 = PW * 4;
        CUTOFF.forEach((c, i) => {
            const cy = 82 + i * 62;
            const hit = this.addClickablePart(`cutoff-${i + 1}`, cx0 + 8, cy - 28, 152, 56, true);
            hit.on('click', () => this.toggleCutoff(i));
        });
    }

    _hit(x, y, w, h, fn) {
        const hit = new Konva.Rect({ x: x - w / 2, y: y - h / 2, width: w, height: h, fill: 'rgba(255,255,255,0.01)', listening: true, cursor: 'pointer' });
        this._dynamicGroup.add(hit);
        hit.on('click tap', (e) => { e.cancelBubble = true; fn(); });
    }

    _bindInteraction() {
        this._registerParts();
        // 屏 1：控制方式 / 起动 / 停止 / 调频
        this._hit(112, 168, 96, 36, () => { this._egMode = this._egMode ? 0 : 1; this._tip(`应急发电机控制方式：${this._egMode ? '自动（禁止手动起停）' : '手动'}`); this._refresh(); });
        this._hit(68, 215, 96, 36, () => this.setEmergencyGen(true));
        this._hit(164, 215, 88, 36, () => this.setEmergencyGen(false));
        this._hit(88, 282, 34, 52, () => this._egGovAdj(-1));      // 左转：频率降低
        this._hit(136, 282, 34, 52, () => this._egGovAdj(1));      // 右转：频率升高
        // 屏 2：控制模式 / 应急合分闸 / 联络开关 / 联络合分闸
        const x0 = PW;
        this._hit(x0 + 48, 212, 80, 40, () => { this._epCtl = this._epCtl ? 0 : 1; this._tip(`应急配电板控制模式：${this._epCtl ? '自动' : '手动'}`); this._refresh(); });
        this._hit(x0 + 128, 212, 44, 44, () => this.epClose(true));
        this._hit(x0 + 188, 212, 44, 44, () => this.epClose(false));
        this._hit(x0 + 48, 286, 80, 40, () => { this._epTest = this._epTest ? 0 : 1; this._tip(`联络开关：${this._epTest ? '正常（允许自动转换）' : '试验'}`); this._refresh(); });
        // 屏 3：合闸 / 分闸 / 相序转换
        const sx = PW * 2;
        this._hit(sx + 66, 278, 46, 46, () => this.setShore(true));
        this._hit(sx + 158, 278, 46, 46, () => this.setShore(false));
        this._hit(sx + 88, 206, 36, 76, () => this._spShift(-1));    // 左半区：向左跳一档
        this._hit(sx + 136, 206, 36, 76, () => this._spShift(1));    // 右半区：向右跳一档
        // 屏 4：模式旋钮 / 起动询问 / 停止
        const hx = PW * 3;
        this._hit(hx + 54, 242, 62, 62, () => { this._hlMode = this._hlMode ? 0 : 1; this._tip(`重载启动方式：${this._hlMode ? '重载询问' : '直接起动'}`); this._refresh(); });
        this._hit(hx + 157, 212, 106, 32, () => this.onHeavyInquiry());
        this._hit(hx + 157, 256, 106, 32, () => this.onHeavyStop());
        // 屏 5：4 个自锁式应急切断按钮
        const cx0 = PW * 4;
        CUTOFF.forEach((c, i) => {
            this._hit(cx0 + 128, 82 + i * 62, 64, 56, () => this.toggleCutoff(i));
        });
    }

    /** 调速开关：右转频率升高、左转频率降低；松开后自动复位到中间位置 */
    _egGovAdj(dir) {
        this._egGovHz = Math.max(-1.0, Math.min(1.0, +(this._egGovHz + dir * 0.1).toFixed(2)));
        this._egGovDeg = dir * 40;
        this._refresh();
        this._tip(`应急发电机调频：${dir > 0 ? '右转加速' : '左转减速'} → ${(60 + this._egGovHz).toFixed(1)} Hz`);
        if (this._egGovTimer) clearTimeout(this._egGovTimer);
        this._egGovTimer = setTimeout(() => {       // 松开 → 弹簧复位到中间
            this._egGovDeg = 0;
            this._refresh();
            if (this._egGovNode) this._egGovNode.to({ rotation: 0, duration: 0.2 });
        }, 250);
    }
    /** 应急发电机故障（影响“应急备用”灯与自动起动） */
    setEGenFault(on) { this._egFault = !!on; if (on && this._egRun) { this._egRun = false; this._egfClosed = false; } this._refresh(); }
    getEGenFault() { return this._egFault; }

    // ── 交互 API ──
    _tip(msg) { if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2600); }
    _lv() { return (this.sys && this.sys.comps) ? this.sys.comps.lv_switch_panel : null; }
    _genReady() { return this._egRun && this._egT >= 5; }
    _busLive() { return this._epSupply(); }
    /** 应急配电板是否由应急电源供电（应急主开关合闸 或 岸电供电） */
    _epSupply() { return !!(this._egfClosed && this._genReady()); }

    setEmergencyGen(on) {
        if (this._egMode === 1) { this._tip('控制方式为“自动”：禁止手动起动 / 停止'); return; }   // 自动位禁止手动起停
        this._egRun = !!on;
        this._egT = 0;
        this._tip(on ? '应急发电机手动起动（5s 建压）' : '应急发电机手动停机');
        this._refresh();
    }
    /** 应急配电板应急合分闸（“自动”模式下由 ATS 自动执行） */
    epClose(on) {
        if (this._epCtl === 1 && this._epTest === 1) { this._tip('控制模式为“自动”：由 ATS 自动合分闸'); return; }
        if (on) {
            if (this._tieClosed) { this._tip('联络开关在合闸位：应急主开关与其互锁，无法合闸'); return; }   // 互锁
            if (!this._genReady() && !this._spOn) { this._tip('应急电源未就绪，无法合闸'); return; }
            this._egfClosed = true; this._tip('应急主开关手动合闸：应发供电');
        } else { this._egfClosed = false; this._tip('应急主开关手动分闸'); }
        this._refresh();
    }
    /** 主电网是否送到应急配电板联络开关：主配电板汇流排带电 且 右动力负载屏“应急配电板”开关闭合 */
    _mainAvailable() {
        const lv = this._lv();
        if (!lv) return false;
        const get = id => (typeof lv.getMCBState === 'function') ? lv.getMCBState(id) : false;
        if (get('ld-loadR-4-1')) return true;          // 岸电开关合闸：岸电经主配电板供电 → 主电网有电
        const busLive = (typeof lv.isBusLive === 'function') ? lv.isBusLive() : false;
        return !!(busLive && get('ld-loadR-4-0'));     // 发电机供电 + 应急配电板开关闭合
    }
    getEmergencyGen() { return this._egRun; }
    setShore(on) {
        // 岸电箱的合闸/分闸按钮可直接操作；与发电机主开关的联锁在主配电板“岸电开关”上
        if (this._spKnob === 1) { this._tip('相序开关在 OFF 位：合闸、分闸按钮均不工作'); return; }
        this._spOn = !!on;
        this._pushShoreLive(true);
        this._tip(on ? '岸电合闸：主配电板“岸电开关”下端带电' : '岸电分闸：主配电板“岸电开关”下端失电');
        this._refresh();
    }
    /** 应急发电机主开关是否合闸（供主配电板岸电开关联锁用） */
    isEGenClosed() { return !!this._egfClosed; }
    /** 联络开关是否合闸（供单线图跟随模式用） */
    isTieClosed() { return !!this._tieClosed; }
    /** 岸电相序是否为负序（相序开关不在 OFF 位且该档为负序） */
    getShoreSeqWrong() { return this._spKnob !== 1 && !this._isCorrectSeq(); }
    /** 岸电箱进线电源（电源指示灯） */
    setShoreSupply(on) { this._spSupply = !!on; this._refresh(); }
    getShoreSupply() { return !!this._spSupply; }
    /** 相序开关档位切换：dir=-1 向左跳一档 / dir=+1 向右跳一档（两端限位） */
    _spShift(dir) {
        const n = Math.max(0, Math.min(2, this._spKnob + dir));
        if (n === this._spKnob) { this._tip(`相序转换已在${['相序1', 'OFF', '相序2'][n]}档`); return; }
        this._spKnob = n;
        const name = ['相序1', 'OFF', '相序2'][n];
        const seq = n === 1 ? '' : (this._isCorrectSeq() ? '（正序）' : '（负序）');
        this._pushShoreLive(true);
        this._tip(`相序转换：${name}${seq}`);
        this._refresh();
    }
    /** 当前档位是否为正序 */
    _isCorrectSeq() {
        if (this._spKnob === 0) return this._seq1Correct;
        if (this._spKnob === 2) return !this._seq1Correct;
        return false;
    }
    /**
     * 岸电开关下端指示状态：0 = 下端没电（无指示）
     *                          1 = 下端有电且相序正确 → 亮绿点
     *                          2 = 下端有电但相序为负序 → 亮红点
     */
    _shoreState() {
        if (!(this._spOn && this._spKnob !== 1)) return 0;
        return this._isCorrectSeq() ? 1 : 2;
    }
    _pushShoreLive(force) {
        const lv = this._lv();
        if (!lv || typeof lv.setShoreLive !== 'function') return;
        const v = this._shoreState();
        if (!force && String(v) === this._spSig) return;
        this._spSig = String(v);
        lv.setShoreLive(v);
    }
    getShore() { return this._spOn; }
    /** 回应灯状态：0 熄灭 / 3 黄（等待增容）/ 1 绿（允许投入） */
    _hlRespState() {
        if (this._hlMode === 0) return 0;                     // 直接起动：回应灯保持熄灭
        const lv = this._lv();
        const mode = (lv && lv.getPlantMode) ? lv.getPlantMode() : 'HAND';
        if (mode !== 'AUTO') return 0;                        // 手动模式：回应灯保持熄灭
        if (!this._hlInquiry) return 0;
        const ready = (lv && lv.isHeavyLoadReady) ? lv.isHeavyLoadReady() : false;
        return ready ? 1 : 3;                                 // 容量就绪 → 绿；等待电站增容 → 黄
    }
    /** 起动 / 询问按钮 */
    onHeavyInquiry() {
        const lv = this._lv();
        if (!lv) return;
        // ① 直接起动：主电网有电 → 负载直接起动（汇流排 + 负载功率）
        if (this._hlMode === 0) {
            if (!(lv.isMainLive && lv.isMainLive())) { this._tip('主电网无电：重载不能直接起动'); return; }
            this._hlRun = true; this._hlResp = 0;
            if (lv.setHeavyLoad) lv.setHeavyLoad(this._hlPower);
            this._tip(`直接起动：重载投入电网，汇流排增加 ${this._hlPower}kW 负载`);
            this._refresh();
            return;
        }
        // ② 重载询问
        const mode = (lv.getPlantMode) ? lv.getPlantMode() : 'HAND';
        if (mode !== 'AUTO') { this._tip('电站为手动模式：重载询问无效，回应灯保持熄灭'); this._refresh(); return; }
        if (!this._hlInquiry) {                               // 第 1 次按下：发询问信号
            if (!(lv.isMainLive && lv.isMainLive())) { this._tip('主电网无电：无法发出重载询问'); return; }
            this._hlInquiry = true;
            if (lv.requestHeavyLoad) lv.requestHeavyLoad(this._hlPower);
            this._tip('重载询问已发出：等待自动电站并入备用机组、均分负荷（回应灯黄色）');
            this._refresh();
            return;
        }
        if (this._hlRespState() !== 1) {                      // 等待中：按钮无效
            this._tip('重载询问等待中：按钮无效（回应灯黄色）');
            return;
        }
        this._hlRun = true;                                   // 容量就绪 → 重载投入电网
        if (lv.setHeavyLoad) lv.setHeavyLoad(this._hlPower);
        if (lv.releaseHeavyLoad) lv.releaseHeavyLoad();
        this._hlInquiry = false;
        this._tip(`重载投入电网：汇流排增加 ${this._hlPower}kW 负载`);
        this._refresh();
    }
    /** 停止按钮：重载退出电网（负载卸掉） */
    onHeavyStop() {
        this._hlRun = false; this._hlInquiry = false;
        const lv = this._lv();
        if (lv) { if (lv.setHeavyLoad) lv.setHeavyLoad(0); if (lv.releaseHeavyLoad) lv.releaseHeavyLoad(); }
        this._tip('重载退出电网：负载已卸掉');
        this._refresh();
    }

    /** 应急切断按钮：按下自锁（送分励脱扣），再按一次弹出（解除） */
    toggleCutoff(i) {
        if (i < 0 || i >= CUTOFF.length) return;
        this._pressed[i] = !this._pressed[i];
        this._animateCap(i);
        this._pushToMainPanel(true);
        this._refresh();
    }
    setCutoff(i, on) {
        if (i < 0 || i >= CUTOFF.length) return;
        if (this._pressed[i] === !!on) return;
        this._pressed[i] = !!on;
        this._animateCap(i);
        this._pushToMainPanel(true);
        this._refresh();
    }
    getCutoff(i) { return !!this._pressed[i]; }
    getCutoffState() { return this._pressed.map(p => !!p); }

    _animateCap(i) {
        const cap = this._caps[i];
        if (!cap) return;
        const cy = 82 + i * 62, on = this._pressed[i];
        cap.fill(on ? '#7a1010' : '#c02020');                       // 按下变暗
        cap.to({ y: on ? cy - 14 : cy - 19, duration: 0.15 });      // 按下沉入 / 弹出凸起（动画）
    }

    /** 把应急切断状态推送给主配电板（逻辑关联，无电气端口） */
    _pushToMainPanel(fireTrip) {
        const lv = this._lv();
        if (!lv) return;
        const sig = this._pressed.map(p => (p ? 1 : 0)).join('');
        if (!fireTrip && sig === this._sig) return;
        this._sig = sig;
        const map = {};
        CUTOFF.forEach((c, i) => { map[c.tag] = !!this._pressed[i]; });
        if (typeof lv.setShuntLive === 'function') lv.setShuntLive(map);
        CUTOFF.forEach((c, i) => {
            if (!this._pressed[i]) return;
            const k = (typeof lv.shuntTripTag === 'function') ? lv.shuntTripTag(c.tag) : 0;
            this._tip(`${c.label}${c.sub}：分励脱扣 ${k} 路开关（未弹出前无法合闸）`);
        });
    }

    /**
     * 应急配电板自动转电（ATS）阶段机（控制模式=自动；联络开关“试验”位同样强制转电）
     *  主电失电：联络断开 → 3s 起动应发 → 5s 建压完成 → 10s 应急主开关合闸 → 应发供电
     *  主电恢复：应急主开关立即跳闸 → 3s 合联络（恢复主电供电）→ 10s 应发自动停机
     *  联络开关打“试验”：联络自动断开，同样跑自动起动 / 自动合闸序列
     */
    /** 状态行文字：自动模式按 ATS 阶段显示；手动模式按实际设备状态显示（不会一直是“待机”） */
    _statusText() {
        if (this._epCtl === 1 && this._phase !== 'idle') return ATS_TXT[this._phase] || '待机';
        if (this._epSupply()) return '应发供电';          // 应急主开关合闸且应发就绪（含手动合闸）
        if (this._egRun) return this._genReady() ? '应发运行' : '建压中';
        if (!this._mainAvailable()) return '主电失电';
        return '待机';
    }

    /** 起动流程中主电网恢复 → 立即中断当前流程，转“延时停机”状态 */
    _abortStart() {
        if (this._egRun) {
            this._phase = 'stop_delay'; this._phaseT = 0;
            this._tip('主电网恢复：中断应发起动流程，应发延时 10s 自动停机');
        } else {
            this._phase = 'idle'; this._phaseT = 0;
            this._tip('主电网恢复：中断应发起动流程，回到待机');
        }
    }

    _stepATS(dt, mainOK) {
        const test = !this._epTest;                  // 联络开关“试验”位
        const need = !mainOK || test;                // 需要应发供电
        if (!mainOK) this._tieClosed = false;        // 主电网失电 → 联络开关断开
        if (test) this._tieClosed = false;           // 联络开关打“试验”位 → 一定断开
        // 状态一致性：机组已停机（手动停机 / 失压跳闸等）→ 应发供电不再成立，回到待机
        if (!this._egRun && ['gen_build', 'eqf_delay', 'running', 'restore_tie', 'restore_stop'].includes(this._phase)) {
            this._phase = 'idle'; this._phaseT = 0;
        }
        if (this._epCtl !== 1) return;               // 手动模式：冻结当前运行状态（如应发供电则保持不变）
        switch (this._phase) {
            case 'idle':
                this._tieClosed = mainOK && !test; this._egfClosed = false;
                if (!need) {
                    // 不需要应发供电但机组仍在运行（如由手动切回自动）→ 延时 10s 自动停机
                    if (this._egRun) { this._phase = 'stop_delay'; this._phaseT = 0; this._tip('主电网正常：应发延时 10s 自动停机'); }
                } else if (!this._egFault && this._egMode === 1) {      // 机旁控制方式须在“自动”才自动起动
                    this._tieClosed = false; this._phase = 'gen_start'; this._phaseT = 0;
                    this._tip(mainOK ? '联络开关“试验”：应发自动起动供电' : '主电网失电：联络开关断开，应发起动延时 3s');
                }
                break;
            case 'stop_delay':
                this._tieClosed = mainOK && !test; this._egfClosed = false;
                this._phaseT += dt;
                if (need) { this._phase = this._genReady() ? 'eqf_delay' : (this._egRun ? 'gen_build' : 'gen_start'); this._phaseT = 0; }   // 又需要应发供电 → 继续/重新起机
                else if (this._phaseT >= 10) { this._egRun = false; this._egT = 0; this._phase = 'idle'; this._phaseT = 0; this._tip('应发自动停机'); }
                break;
            case 'gen_start':
                this._tieClosed = false;
                if (!need) { this._abortStart(); break; }        // 主电网恢复 → 中断起动流程
                this._phaseT += dt;
                if (this._phaseT >= 3) { this._egRun = true; this._egT = 0; this._phase = 'gen_build'; this._phaseT = 0; this._tip('应急发电机自动起动（5s 建压）'); }
                break;
            case 'gen_build':
                this._tieClosed = false;
                if (!need) { this._abortStart(); break; }        // 主电网恢复 → 中断建压流程
                if (this._genReady()) { this._phase = 'eqf_delay'; this._phaseT = 0; this._tip('应发建压完成：延时 10s 合应急主开关'); }
                break;
            case 'eqf_delay':
                this._tieClosed = false;
                if (!need) { this._abortStart(); break; }        // 主电网恢复 → 中断合闸延时，不合闸
                this._phaseT += dt;
                if (this._phaseT >= 10) { this._egfClosed = true; this._phase = 'running'; this._phaseT = 0; this._tip('应急主开关合闸：进入应发供电状态'); }
                break;
            case 'running':
                this._tieClosed = false;
                this._egfClosed = this._genReady();
                if (!need) { this._egfClosed = false; this._phase = 'restore_tie'; this._phaseT = 0; this._tip('主电网恢复：应发主开关立即跳闸，延时 3s 合联络'); }
                break;
            case 'restore_tie':
                this._egfClosed = false; this._tieClosed = test ? false : this._tieClosed;
                this._phaseT += dt;
                if (this._phaseT >= 3) { this._tieClosed = true; this._phase = 'restore_stop'; this._phaseT = 0; this._tip('联络开关闭合：恢复主电网供电，延时 10s 应发自动停机'); }
                break;
            case 'restore_stop':
                this._tieClosed = true;
                this._phaseT += dt;
                if (this._phaseT >= 10) { this._egRun = false; this._egT = 0; this._phase = 'idle'; this._phaseT = 0; this._tip('应发自动停机'); }
                break;
        }
    }

    tick(dt) {
        const mainOK = this._mainAvailable();     // 主配电板汇流排有电 且 右动力负载屏“应急配电板”开关闭合
        this._stepATS(dt, mainOK);
        if (this._egRun) this._egT = Math.min(5, this._egT + dt);
        else {
            this._egT = 0;
            if (this._egfClosed) { this._egfClosed = false; this._tip('应急发电机停机：应发主开关失压瞬时跳闸'); }   // 失压保护
        }
        this._pushToMainPanel(false);
        // 岸电箱出线开关失压保护：相序开关打到 OFF → 失压自动分闸
        if (this._spKnob === 1 && this._spOn) {
            this._spOn = false;
            this._tip('岸电箱开关失压保护：相序开关打到 OFF，开关自动分闸');
        }
        this._pushShoreLive(false);          // 岸电开关下端带电状态同步给主配电板

        // ── 屏 1：应急发电机 ──
        const ready = this._genReady();
        const U = ready ? 450 : (this._egRun ? Math.round(200 + 250 * this._egT / 5) : 0);
        const F = ready ? +(60 + this._egGovHz).toFixed(1) : (this._egRun ? +(30 + 30 * this._egT / 5).toFixed(1) : 0);
        const P = ready && this._egfClosed ? 80 : 0;                                  // 应急配电板默认负载 80kW
        const I = ready && this._egfClosed ? 119 : 0;                                 // I = 80kW/(√3·450V·0.86)
        const lcd = this._egLcd;
        if (lcd.length === 5) {
            lcd[0].text(`V ${U ? U : '—'}`);
            lcd[1].text(`F ${F ? F.toFixed(1) : '—'}`);
            lcd[2].text(`I ${I ? I : '—'}`);
            lcd[3].text(`P ${P ? P : '—'}`);
            lcd[4].text(`COS ${P ? '0.86' : '—'}`);
        }
        if (this._egLever) this._egLever.rotation(this._egMode ? 28 : -28);
        if (this._egGov) this._egGov.rotation(this._egGovDeg || 0);

        // ── 屏 2：应急配电板 ──
        if (this._epLcd && this._epLcd.length === 3) {
            this._epLcd[0].text(`主电  ${mainOK ? '450V' : '——V'}`);
            this._epLcd[1].text(`应急  ${this._genReady() ? '60.0Hz   450V' : '——Hz   ——V'}`);
            const cd = (this._phase === 'restore_stop' || this._phase === 'stop_delay') ? ` ${Math.max(0, Math.ceil(10 - this._phaseT))}s` : '';
            this._epLcd[2].text(`${this._epCtl ? '自动' : '手动'}-${this._epTest ? '正常' : '试验'}  ${this._statusText()}${cd}`);
        }
        if (this._epLamp) {
            this._epLamp[0].fill(mainOK ? GREEN : '#d6dce1');                              // 主板配电有电
            // 应急备用：应发打在“自动”、无故障且处于停机状态
            this._epLamp[1].fill((this._egMode === 1 && !this._egFault && !this._egRun) ? '#ffd400' : '#d6dce1');
            this._epLamp[2].fill(this._egRun ? GREEN : '#d6dce1');                          // 应急运行：应发一起动即亮
        }
        if (this._epLever) this._epLever.rotation(this._epCtl ? 28 : -28);
        if (this._epTie) this._epTie.rotation(this._epTest ? 28 : -28);
        if (this._epBtn) {
            const closed = this._egfClosed;
            this._epBtn[0].fill(closed ? '#2ecc40' : '#1e4d24');    // 合闸钮：合闸=亮绿 / 分闸=暗绿
            this._epBtn[1].fill(closed ? '#5a1a14' : '#e0392b');    // 分闸钮：合闸=暗红 / 分闸=亮红
        }
        if (this._epTieLed) {
            this._epTieLed[0].fill(this._tieClosed && mainOK ? GREEN : '#3a4249');    // 联络合闸
            this._epTieLed[1].fill(this._tieClosed ? '#3a4249' : '#ff2020');          // 联络分闸
        }

        // ── 屏 3：岸电箱 ──
        // 液晶：只要打到相序1或相序2档就显示 450V / 60Hz
        if (this._spLcd) this._spLcd.text(this._spKnob === 1 ? '---V, ---Hz' : '450V, 60.0Hz');
        if (this._spLamp) {
            const on = this._spKnob !== 1;
            const pos = on && this._isCorrectSeq();       // 该档为正序
            const neg = on && !this._isCorrectSeq();      // 该档为负序
            this._spLamp[0].fill(this._spSupply ? '#ffffff' : '#3a4249');              // 电源：进线有电 → 亮白
            this._spLamp[1].fill(pos ? '#22c832' : '#1a4d20');                          // 正序：有效亮绿 / 默认暗绿
            this._spLamp[2].fill(neg ? '#e0392b' : '#5a1a14');                          // 负序：有效亮红 / 默认暗红
        }
        // 合闸/分闸按钮：OFF 位 → 两只均为暗绿且不工作；否则 合闸亮绿(合)/暗绿(分)、分闸亮红(分)/暗红(合)
        if (this._spBtn) {
            if (this._spKnob === 1) { this._spBtn[0].fill('#1e4d24'); this._spBtn[1].fill('#5a1a14'); }   // OFF 位：默认暗绿 / 暗红（均不工作）
            else {
                this._spBtn[0].fill(this._spOn ? '#2ecc40' : '#1e4d24');
                this._spBtn[1].fill(this._spOn ? '#5a1a14' : '#e0392b');
            }
        }
        if (this._spKnobNode) this._spKnobNode.rotation((this._spKnob - 1) * 60);

        // ── 屏 4：重载询问 ──
        if (this._hlPowerText) this._hlPowerText.text(String(this._hlPower));
        if (this._hlRunLamp) this._hlRunLamp.fill(this._hlRun ? GREEN : '#8a929c');
        if (this._hlRespLamp) {
            const st = this._hlRespState();
            this._hlRespLamp.fill(st === 1 ? GREEN : (st === 3 ? '#ffd400' : '#8a929c'));   // 绿 允许 / 黄 等待 / 灰 熄灭
        }
        if (this._hlKnob) this._hlKnob.rotation(this._hlMode ? 30 : -30);

        // ── 屏 5：应急切断状态灯 ──
        if (this._cutLed) this._cutLed.forEach((l, i) => l.fill(this._pressed[i] ? '#ff2020' : '#2a2f34'));

        this._refresh();
    }

    _refresh() {
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    getConfigFields() { return []; }
}
