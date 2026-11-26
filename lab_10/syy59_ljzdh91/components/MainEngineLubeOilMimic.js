import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * MainEngineLubeOilMimic — 主机滑油系统 MIMIC 图
 * ═══════════════════════════════════════════════════════════════
 *  流程：柴油机（Engine.js 版式）→ 滑油循环柜
 *        → 两台并联滑油泵（水平支路：手动截止阀 + 泵 + 单向阀）
 *        → 出口分两路：旁通（上方）/ 滑油冷却器（下方，带低温淡水进出）
 *        → 三通调节阀汇合 → 向上向左 → 滤器（与柴油机入口同一水平高度）
 *        → 滤器出口上方 YT1226 压力开关 + 压力变送器(4-20mA)
 *        → 柴油机右下滑油入口
 *  另：出口管上的温度传感器 → 红色虚线 → PID 调节器面板 → 虚线 → 三通阀执行器
 *  右侧：两台滑油泵控制面板（电源/运行/过载 + 起动/停止/手动自动）
 *
 *  部件 id：v1 v2 p1 p2 ck1 ck2 cv3 flt cooler tank engine
 *          psw pt tt pid pid-man pid-auto pid-sv-up pid-sv-dn
 *          pp1-start pp1-stop pp1-mode pp2-start pp2-stop pp2-mode
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1470, H = 800;   // 顶部留 60 留边、底部截掉 60（内部相对位置不变）
const TRI_A = 13.5, TRI_B = 9.5;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Microsoft YaHei, Arial' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_PIPE = '#a8cdb8';      // 管路底色（淡绿）：让滑油流动虚线（橙）更醒目

// 滑油温度高 → 自动减速：> 60 ℃ 延时 6 s 触发，< 58 ℃ 还原（回差 2 ℃）
const LO_SLD_ON = 60, LO_SLD_OFF = 58, LO_SLD_DELAY = 6;
const C_GREEN = '#2ecc40';
const C_GRAY = '#b0b6bb';

function triPts(cx, cy, ang, a = TRI_A, b = TRI_B) {
    const r = ang * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
    const px = -uy, py = ux, bx = cx + ux * a, by = cy + uy * a;
    return [bx + px * b, by + py * b, bx - px * b, by - py * b, cx, cy];
}

export class MainEngineLubeOilMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = W;
        this.height = H;
        this.type = 'me_lo_mimic';
        this.cache = 'fixed';

        this.m = {
            valves: { v1: true, v2: true },
            pumps: {
                p1: { on: true, power: true, overload: false, auto: true },    // 自动运行
                p2: { on: false, power: true, overload: false, auto: true },   // 备用
            },
            cv3: 55,
            pid: { auto: true, sv: 45, out: 55, pv: 45 },
            engOn: true,        // 柴油机默认运行
            shdTrip: false,     // 安保停车标志（滑油低压开关动作 → 自动停车）
            fuelRate: 0.5,      // 负荷 50%
            press: 0.45,        // 泵出口压力
            filtUse: 0.02,      // 滤器压降
            inletPress: 0.43,   // 主机滑油入口压力
            standbyTimer: 0,    // 备用泵延时
            sw3: 'line',        // PT-101 侧三通阀
            sw3b: 'line',       // 压力继电器侧三通阀（独立）        // 手动三通阀：line=测管路（上下通）/ pump=测手摇泵（上右通）
            handP: 0.3,         // PT-101 侧手摇泵输出压力（初始 0.3 MPa）
            handP2: 0.2,        // 压力继电器侧手摇泵输出压力（独立，初始 0.2 MPa）
            psw: { sp: 0.15, diff: 0.04 },   // 压力开关给定值 / 幅差（MPa）
            pswClosed: true,
            temp: 45,
            t: 0,
        };

        this._initGroups();
        this._init();
        this.config = { id: this.id };
    }

    _tip() { /* 不弹提示 */ }

    _init() {
        // 顶部增高 60px：三层的图形统一下移 60，背景单独铺满
        const bg = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: '#f7f9f9', stroke: '#c3c9c6', strokeWidth: 1, listening: false });
        this.group.add(bg);
        bg.moveToBottom();
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
        this._addDragPlate();
        this._staticGroup.y(60);
        this._dynamicGroup.y(60);
        this._interactGroup.y(60);
        this._syncInitial();
    }

    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
        this.group.draggable(true);
    }

    // ═══════════════════════════════════════════════════════
    //  静态
    // ═══════════════════════════════════════════════════════

    _pipe(s, pts, w = 3.2) {
        s.add(_line({ points: pts, stroke: C_PIPE, strokeWidth: w, lineCap: 'round', lineJoin: 'round' }));
    }

    /** 柴油机（按 Engine.js 版式重绘，整体下移 30px → oy=60） */
    _engine(s) {
        const ox = 40, oy = 100;
        s.add(_rect({ x: ox + 10, y: oy + 30, width: 220, height: 140, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 3 }));
        // 增压器
        s.add(new Konva.Arc({ x: ox + 210, y: oy + 40, innerRadius: 6, outerRadius: 20, angle: 300, fill: '#7f8c8d', stroke: '#2c3e50', rotation: -150, listening: false }));
        s.add(_circle({ x: ox + 210, y: oy + 40, radius: 8, fill: '#34495e', stroke: '#2c3e50' }));
        // 排气歧管
        s.add(_rect({ x: ox + 10, y: oy + 30, width: 180, height: 18, fill: '#2c3e50', cornerRadius: 2 }));
        for (let i = 0; i < 4; i++) {
            const x = ox + 45 + i * 45;
            s.add(_rect({ x: x - 21, y: oy + 50, width: 42, height: 70, stroke: '#34495e', strokeWidth: 1, fill: 'rgba(255,255,255,0.35)' }));
            s.add(_rect({ x: x - 10, y: oy + 133, width: 20, height: 22, fill: '#2980b9', stroke: '#1a5276', strokeWidth: 1, cornerRadius: 3 }));
            s.add(_rect({ x: x - 22, y: oy + 140, width: 14, height: 12, fill: '#1e6ab6' }));
            s.add(_rect({ x: x + 10, y: oy + 140, width: 14, height: 12, fill: '#1c65ae' }));
        }
        // 油底壳
        s.add(_rect({ x: ox + 10, y: oy + 165, width: 220, height: 10, fill: '#34495e', stroke: '#2c3e50', cornerRadius: [0, 0, 3, 3] }));
        s.add(_text({ x: ox + 50, y: oy - 28, width: 160, align: 'center', fontSize: 17, fontStyle: 'bold', fill: '#111', text: '主机（柴油机）' }));
        // 起停开关刻度盘（OFF / ON）
        s.add(_circle({ x: ox + 32, y: oy + 10, radius: 18, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 2 }));
        s.add(_text({ x: ox + 2, y: oy - 5, fontSize: 10, fill: '#c0392b', fontStyle: 'bold', text: 'OFF' }));
        s.add(_text({ x: ox + 42, y: oy - 5, fontSize: 10, fill: '#27ae60', fontStyle: 'bold', text: 'ON' }));
        // 负荷刻度盘
        s.add(new Konva.Arc({ x: ox + 160, y: oy + 15, innerRadius: 16, outerRadius: 22, angle: 180, fill: '#0d9a5a', stroke: '#2c3e50', strokeWidth: 1, rotation: 180, listening: false }));
        s.add(_text({ x: ox + 134, y: oy + 20, text: 'FUEL / LOAD', fontSize: 9, fill: '#2c3e50', fontStyle: 'bold' }));
        s.add(_text({ x: ox + 196, y: oy + 30, width: 40, align: 'center', fontSize: 11, fill: '#2c3e50', text: '负荷' }));
        // 滑油出口：标注右移 30px，出口线画向下箭头
        s.add(_text({ x: ox + 42, y: oy + 176, width: 100, fontSize: 11, fill: '#2c3e50', text: '滑油出口' }));
        s.add(_line({ points: [ox + 110, oy + 202, ox + 104, oy + 190, ox + 116, oy + 190], closed: true, fill: C_PIPE }));
        // 滑油入口：标注放在入口线上方，入口线画向左箭头
        s.add(_text({ x: ox + 260, y: oy + 116, width: 100, fontSize: 11, fill: '#2c3e50', text: '滑油入口' }));
        s.add(_line({ points: [ox + 245, oy + 140, ox + 257, oy + 134, ox + 257, oy + 146], closed: true, fill: C_PIPE }));
    }

    _tank(s) {
        s.add(_rect({ x: 60, y: 590, width: 220, height: 120, fill: '#eef4f7', stroke: '#333', strokeWidth: 2.4, cornerRadius: 3 }));
        s.add(_rect({ x: 64, y: 638, width: 212, height: 68, fill: '#bfe3f5' }));
        s.add(_text({ x: 60, y: 598, width: 220, align: 'center', fontSize: 15, fill: '#111', text: '滑油循环柜' }));
    }

    _cooler(s) {
        s.add(_text({ x: 830, y: 616, width: 140, align: 'center', fontSize: 14, fill: '#111', text: '滑油冷却器' }));
        s.add(_rect({ x: 830, y: 640, width: 140, height: 80, fill: '#eef7ff', stroke: '#333', strokeWidth: 2.4, cornerRadius: 4 }));
        for (let i = 0; i < 4; i++) s.add(_line({ points: [842, 658 + i * 16, 958, 658 + i * 16], stroke: '#7fb6d8', strokeWidth: 2 }));
        // 低温淡水：左下出口（箭头向下）、右下入口（箭头向上）
        this._pipe(s, [850, 720, 850, 766], 2.6);
        this._pipe(s, [950, 720, 950, 766], 2.6);
        s.add(_line({ points: [850, 766, 844, 754, 856, 754], closed: true, fill: C_PIPE }));
        s.add(_line({ points: [950, 722, 944, 734, 956, 734], closed: true, fill: C_PIPE }));
        s.add(_text({ x: 740, y: 762, width: 104, align: 'right', fontSize: 12, fill: '#1f6f43', text: '低温淡水出口' }));
        s.add(_text({ x: 960, y: 762, width: 104, fontSize: 12, fill: '#1f6f43', text: '低温淡水入口' }));
    }

    _filter(s) {
        s.add(_rect({ x: 930, y: 200, width: 130, height: 80, fill: '#ffffff', stroke: '#333', strokeWidth: 2.4, cornerRadius: 4 }));
        for (let i = 0; i < 5; i++) s.add(_line({ points: [946 + i * 20, 212, 946 + i * 20, 268], stroke: '#9aa4aa', strokeWidth: 1.6 }));
        s.add(_text({ x: 930, y: 282, width: 130, align: 'center', fontSize: 14, fill: '#111', text: '滑油滤器' }));
    }

    _instrument(s, x, y, w, h, l1, l2) {
        s.add(_rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: '#333', strokeWidth: 2, cornerRadius: 3 }));
        s.add(_line({ points: [x, y + h / 2, x + w, y + h / 2], stroke: '#333', strokeWidth: 1.4 }));
        s.add(_text({ x, y: y + 4, width: w, align: 'center', fontSize: 12, fontStyle: 'bold', fill: '#111', text: l1 }));
        s.add(_text({ x, y: y + h / 2 + 3, width: w, align: 'center', fontSize: 11, fill: '#333', text: l2 }));
    }

    /** PID 调节器面板（PV/SV/OUT 三行 + 第4行四个按钮） */
    _pidPanel(s) {
        s.add(_rect({ x: 650, y: 320, width: 250, height: 190, fill: '#e9edee', stroke: '#333', strokeWidth: 2.4, cornerRadius: 6 }));
        s.add(_rect({ x: 650, y: 320, width: 250, height: 28, fill: '#cdd4d6', stroke: '#333', strokeWidth: 2, cornerRadius: 6 }));
        s.add(_text({ x: 650, y: 324, width: 250, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#111', text: '滑油温度调节器 TIC-101' }));
        // 三行：标签 + 数值框（同一水平中线）
        ['PV', 'SV', 'OUT'].forEach((k, i) => {
            const y = 365 + i * 28;
            s.add(_text({ x: 664, y: y + 3, width: 40, fontSize: 13, fontStyle: 'bold', fill: '#333', text: k }));
            s.add(_rect({ x: 706, y, width: 120, height: 22, fill: '#ffffff', stroke: '#888', strokeWidth: 1.2 }));
        });
        // 第 4 行：手动 / 自动 / 增加 / 减少
        [[662, 56, '手动'], [724, 56, '自动']].forEach(([x, w, t]) => {
            s.add(_rect({ x, y: 457, width: w, height: 26, fill: '#ffffff', stroke: '#555', strokeWidth: 1.6, cornerRadius: 2 }));
        });
        [[788, 42, '▲'], [836, 42, '▼']].forEach(([x, w, t]) => {
            s.add(_rect({ x, y: 457, width: w, height: 26, fill: '#ffffff', stroke: '#555', strokeWidth: 1.6, cornerRadius: 2 }));
            s.add(_text({ x, y: 460, width: w, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#111', text: t }));
        });
    }

    /** 滑油泵控制面板（三列对称：标签 + 灯；按钮 + 标签） */
    _pumpPanel(s, x, y, name) {
        s.add(_rect({ x, y, width: 260, height: 190, fill: '#dfe4e5', stroke: '#333', strokeWidth: 2.4, cornerRadius: 4 }));
        const cols = [x + 52, x + 130, x + 208];
        ['电源', '运行', '过载'].forEach((label, i) => {
            s.add(_rect({ x: cols[i] - 32, y: y + 10, width: 64, height: 22, fill: '#ffffff', stroke: '#666', strokeWidth: 1.4 }));
            s.add(_text({ x: cols[i] - 32, y: y + 13, width: 64, align: 'center', fontSize: 13, fill: '#111', text: label }));
        });
        // 起动 / 停止：金属外框（不画文字标注）
        [cols[0], cols[1]].forEach((cx) => {
            s.add(_circle({
                x: cx, y: y + 110, radius: 27,
                fillLinearGradientStartPoint: { x: 0, y: -27 },
                fillLinearGradientEndPoint: { x: 0, y: 27 },
                fillLinearGradientColorStops: [0, '#f4f6f7', 0.45, '#c6cccf', 1, '#8b9295'],
                stroke: '#6d7477', strokeWidth: 1.6,
            }));
        });
        // 手动 / 自动 标注（第三列旋钮）
        s.add(_text({ x: cols[2] - 48, y: y + 77, width: 30, align: 'right', fontSize: 12, fill: '#111', text: '手动' }));
        s.add(_text({ x: cols[2] + 18, y: y + 77, width: 30, fontSize: 12, fill: '#111', text: '自动' }));
        s.add(_text({ x, y: y + 166, width: 260, align: 'center', fontSize: 14, fontStyle: 'bold', fill: '#111', text: name }));
    }

    _drawStatic() {
        const s = this._staticGroup;

        // ── 管路 ──
        this._pipe(s, [150, 275, 150, 590]);                       // 柴油机 → 循环柜
        this._pipe(s, [280, 650, 400, 650, 400, 670]);             // 循环柜 → 吸入总管
        this._pipe(s, [400, 590, 400, 670]);                       // 吸入总管（竖）
        [590, 670].forEach((y) => {                                 // 两条水平支路
            this._pipe(s, [400, y, 446, y]);
            this._pipe(s, [473, y, 514, y]);
            this._pipe(s, [566, y, 606, y]);
            this._pipe(s, [633, y, 700, y]);
        });
        this._pipe(s, [700, 590, 700, 670]);                       // 出口总管（竖）
        this._pipe(s, [700, 630, 760, 630]);                       // 出口
        // 上支路（旁通）→ 直接进入三通阀左侧三角形
        this._pipe(s, [760, 630, 760, 575, 1026, 575]);
        // 冷却器支路（下）→ 右 → 上 → 进入三通阀下方三角形
        this._pipe(s, [760, 630, 760, 680, 830, 680]);
        this._pipe(s, [970, 680, 1040, 680, 1040, 591]);
        // 三通阀出口 → 上 → 左 → 滤器（与柴油机入口同高）
        this._pipe(s, [1054, 575, 1120, 575, 1120, 240, 1060, 240]);
        // 滤器出口 → 左 → 柴油机右下滑油入口（水平）
        this._pipe(s, [930, 240, 270, 240]);
        // PT-101 下方 30px：手动三通转换阀（默认上下通；点击手柄右缩 5px → 上+右通）
        this._pipe(s, [786, 106, 786, 132], 2.6);        // PT → 阀上口
        this._pipe(s, [786, 160, 786, 240], 2.6);        // 阀下口 → 主管（滤器出口压力）
        this._pipe(s, [799, 146, 986, 146], 2.6);        // 阀右口 → 手摇泵
        // 手摇泵 + 压力表
        s.add(_circle({ x: 1010, y: 146, radius: 24, fill: '#eef2f4', stroke: '#333', strokeWidth: 2 }));
        this._hpHandle1 = _line({ points: [1010, 146, 1036, 120], stroke: '#8d5524', strokeWidth: 4, lineCap: 'round' });
        s.add(this._hpHandle1);
        s.add(_circle({ x: 1010, y: 146, radius: 4, fill: '#333' }));
        // 压力表：接在手摇泵 → 三通阀的管路中央（x=892）
        s.add(_line({ points: [892, 134, 892, 146], stroke: '#333', strokeWidth: 2 }));
        s.add(_circle({ x: 892, y: 89, radius: 45, fill: '#ffffff', stroke: '#333', strokeWidth: 2.4 }));
        for (let i = 0; i <= 10; i++) {
            const ang = (-135 + i * 27) * Math.PI / 180;
            const r1 = 45 - (i % 5 === 0 ? 12 : 8);
            s.add(_line({
                points: [892 + Math.sin(ang) * r1, 89 - Math.cos(ang) * r1, 892 + Math.sin(ang) * 38, 89 - Math.cos(ang) * 38],
                stroke: '#333', strokeWidth: i % 5 === 0 ? 1.8 : 1.1,
            }));
            if (i % 2 === 0) {
                s.add(_text({ x: 892 + Math.sin(ang) * 27 - 8, y: 89 - Math.cos(ang) * 27 - 6, width: 16, align: 'center', fontSize: 9, fill: '#333', text: (i / 10).toFixed(1) }));
            }
        }
        s.add(_text({ x: 858, y: 116, width: 68, align: 'center', fontSize: 9, fill: '#333', text: 'MPa' }));
        s.add(_text({ x: 976, y: 176, width: 70, align: 'center', fontSize: 11, fill: '#111', text: '手摇泵' }));

        // 压力继电器下方：手动三通转换阀（+ 压力表 + 手摇泵），与 PT-101 侧完全独立
        this._pipe(s, [480, 160, 480, 179.5], 2.4);              // 上口 → 继电器进气口方向
        this._pipe(s, [480, 206.5, 480, 240], 2.4);              // 下口 → 下方滑油主管（y=240）
        this._pipe(s, [493, 193, 627, 193], 2.4);                // 右口 → 压力表 / 手摇泵
        // 压力表（r=45，接在阀 → 手摇泵的管路中央）
        s.add(_line({ points: [580, 181, 580, 193], stroke: '#333', strokeWidth: 2 }));
        s.add(_circle({ x: 580, y: 136, radius: 45, fill: '#ffffff', stroke: '#333', strokeWidth: 2.4 }));
        for (let i = 0; i <= 10; i++) {
            const ang = (-135 + i * 27) * Math.PI / 180;
            const r1 = 45 - (i % 5 === 0 ? 12 : 8);
            s.add(_line({
                points: [580 + Math.sin(ang) * r1, 136 - Math.cos(ang) * r1, 580 + Math.sin(ang) * 38, 136 - Math.cos(ang) * 38],
                stroke: '#333', strokeWidth: i % 5 === 0 ? 1.8 : 1.1,
            }));
            if (i % 2 === 0) {
                s.add(_text({ x: 580 + Math.sin(ang) * 27 - 8, y: 136 - Math.cos(ang) * 27 - 6, width: 16, align: 'center', fontSize: 9, fill: '#333', text: (i / 10).toFixed(1) }));
            }
        }
        s.add(_text({ x: 546, y: 163, width: 68, align: 'center', fontSize: 9, fill: '#333', text: 'MPa' }));
        // 手摇泵（r=24，与 PT-101 侧一致）
        s.add(_circle({ x: 651, y: 193, radius: 24, fill: '#eef2f4', stroke: '#333', strokeWidth: 2 }));
        this._hpHandle2 = _line({ points: [651, 193, 677, 167], stroke: '#8d5524', strokeWidth: 4, lineCap: 'round' });
        s.add(this._hpHandle2);
        s.add(_circle({ x: 651, y: 193, radius: 4, fill: '#333' }));
        s.add(_text({ x: 616, y: 222, width: 70, align: 'center', fontSize: 11, fill: '#111', text: '手摇泵' }));

        // 仪表取压支管（向上）        // 仪表取压支管（向上）
        this._pipe(s, [786, 240, 786, 106], 2);
        // 温度传感器取压支管
        this._pipe(s, [1094, 410, 1120, 410], 2);

        // ── 设备 ──
        this._engine(s);
        this._tank(s);
        this._cooler(s);
        this._filter(s);
        this._instrument(s, 742, 50, 88, 56, 'PT-101', '4~20mA');
        s.add(_text({ x: 690, y: 4, width: 192, align: 'center', fontSize: 12, fill: '#333', text: '主机滑油入口压力' }));
        this._instrument(s, 1010, 386, 84, 50, 'TT-101', '温度传感器');
        this._pidPanel(s);
        this._pumpPanel(s, 1180, 110, '1# 主机滑油泵控制');
        this._pumpPanel(s, 1180, 380, '2# 主机滑油泵控制');

        // 信号虚线
        s.add(_line({ points: [1010, 410, 900, 410], stroke: '#c0392b', strokeWidth: 1.6, dash: [7, 5] }));
        s.add(_line({ points: [775, 510, 775, 543, 1030, 543], stroke: '#c0392b', strokeWidth: 1.6, dash: [7, 5] }));

        s.add(_text({ x: 400, y: 686, width: 300, align: 'center', fontSize: 13, fill: '#555', text: '两台并联滑油泵（一用一备）' }));
    }

    // ═══════════════════════════════════════════════════════
    //  动态
    // ═══════════════════════════════════════════════════════

    _valveMan(parent, cx, cy, angAxis = 180, angHandle = 270) {
        const mk = (ang) => {
            const n = new Konva.Line({ points: triPts(cx, cy, ang), closed: true, fill: '#ffffff', stroke: '#333', strokeWidth: 1.8, lineJoin: 'round', listening: false });
            parent.add(n); return n;
        };
        const a = mk(angAxis), b = mk(angAxis + 180);
        const r = angHandle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
        const ex = cx + ux * (TRI_B + 9), ey = cy + uy * (TRI_B + 9);
        parent.add(_line({ points: [cx, cy, ex, ey], stroke: '#333', strokeWidth: 1.8 }));
        parent.add(_line({ points: [ex - uy * 6, ey + ux * 6, ex + uy * 6, ey - ux * 6], stroke: '#333', strokeWidth: 2.2 }));
        return { a, b };
    }

    _checkV(parent, cx, cy, angFlow) {
        const mk = (ang, fill) => {
            const n = new Konva.Line({ points: triPts(cx, cy, ang), closed: true, fill, stroke: '#333', strokeWidth: 1.8, lineJoin: 'round', listening: false });
            parent.add(n); return n;
        };
        return { in: mk(angFlow + 180, '#ffffff'), out: mk(angFlow, C_GRAY) };
    }

    _pump(parent, cx, cy, r) {
        const face = new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#ffffff', stroke: '#333', strokeWidth: 2.2, listening: false });
        parent.add(face);
        const fan = new Konva.Group({ x: cx, y: cy, listening: false });
        for (let i = 0; i < 3; i++) {
            fan.add(new Konva.Line({ points: [0, 0, 0, -r * 0.68], stroke: '#333', strokeWidth: 2.4, lineCap: 'round', rotation: i * 120, listening: false }));
        }
        fan.add(new Konva.Circle({ radius: r * 0.22, fill: '#333', listening: false }));
        parent.add(fan);
        return { face, fan };
    }

    /** 三通调节阀：左（旁通）/下（冷却）入，右出；填充三角自阀芯向外按面积比例扩展 */
    _cv3(parent, cx, cy) {
        const A = TRI_A * 1.2, B = TRI_B * 1.2;
        const mk = (ang) => {
            const n = new Konva.Line({ points: triPts(cx, cy, ang, A, B), closed: true, fill: '#ffffff', stroke: '#333', strokeWidth: 1.8, lineJoin: 'round', listening: false });
            parent.add(n); return n;
        };
        const rt = mk(0), lf = mk(180), dn = mk(90);
        // 填充三角（自中心向外缩放，面积 = 原三角 × 开度）
        const mkF = (ang) => {
            const n = new Konva.Line({ points: triPts(cx, cy, ang, A, B), closed: true, fill: '#1e7a2e', listening: false });
            parent.add(n); return n;
        };
        const frt = mkF(0), flf = mkF(180), fdn = mkF(90);
        // 执行器
        parent.add(_line({ points: [cx, cy, cx, cy - A - 10], stroke: '#3fa3e8', strokeWidth: 1.8 }));
        parent.add(_rect({ x: cx - 10, y: cy - A - 22, width: 20, height: 13, fill: '#eaf1fb', stroke: '#3fa3e8', strokeWidth: 1.6, cornerRadius: 2 }));
        parent.add(_line({ points: [cx - 7, cy - A - 19, cx + 7, cy - A - 19], stroke: '#3fa3e8', strokeWidth: 1.4 }));
        parent.add(_line({ points: [cx - 7, cy - A - 15, cx + 7, cy - A - 15], stroke: '#3fa3e8', strokeWidth: 1.4 }));
        // 开度标注：冷却口（下三角右下角）/ 旁通口（左三角左下角）
        const coolTx = _text({ x: cx + B + 6, y: cy + A + 1, width: 90, fontSize: 12, fontStyle: 'bold', fill: '#0d6bb8', text: '冷 55%' });
        const bypTx = _text({ x: cx - A - 74, y: cy + B - 29, width: 74, align: 'right', fontSize: 12, fontStyle: 'bold', fill: '#0d6bb8', text: '旁 45%' });
        parent.add(coolTx, bypTx);
        return { rt, lf, dn, frt, flf, fdn, coolTx, bypTx, A, B, cx, cy };
    }

    _createDynamic() {
        const d = this._dynamicGroup;

        // ── 滑油流动虚线（沿管路走向；速度 = 冷却水流速的一半：每帧相位 +1，冷却水为 +2）──
        this._flowPhase = 0;
        this._flows = [];
        const flow = (pts, cond, w = 4) => {
            const n = new Konva.Line({
                points: pts, stroke: '#e2a020', strokeWidth: (typeof w === 'function' ? 4 : w),
                dash: [9, 7], dashOffset: 0, opacity: 0, lineCap: 'round', listening: false,
            });
            d.add(n);
            this._flows.push({ node: n, cond, w });
        };
        const vkOf = (k) => (k === 'p1' ? 'v1' : 'v2');
        const runK = (k) => {
            const m = this.m;
            return !!(m.pumps[k].on && m.valves[vkOf(k)] && !m.pumps[k].overload);
        };
        const anyRun = () => runK('p1') || runK('p2');
        // 柴油机 → 循环柜 → 吸入总管
        flow([150, 275, 150, 590], () => anyRun());
        flow([280, 650, 400, 650, 400, 670], () => anyRun());
        flow([400, 590, 400, 670], () => anyRun());
        // 两条并联泵支路（截止阀 → 泵 → 单向阀 → 出口总管）
        [['p1', 590], ['p2', 670]].forEach(([k, y]) => {
            flow([400, y, 446, y], () => runK(k), 3.4);
            flow([473, y, 514, y], () => runK(k), 3.4);
            flow([566, y, 606, y], () => runK(k), 3.4);
            flow([633, y, 700, y], () => runK(k), 3.4);
        });
        flow([700, 590, 700, 670], () => anyRun());
        flow([700, 630, 760, 630], () => anyRun());
        // 旁通支路（100 % − 调节阀开度）
        flow([760, 630, 760, 575, 1026, 575], () => anyRun() && this.m.cv3 < 99,
            () => 1.4 + 2.4 * Math.max(0, Math.min(100, 100 - this.m.cv3)) / 100);
        // 滑油冷却器支路（调节阀开度越大流量越大）
        const coolCond = () => anyRun() && this.m.cv3 > 1;
        const coolW = () => 1.4 + 2.4 * Math.max(0, Math.min(100, this.m.cv3)) / 100;
        flow([760, 630, 760, 680, 830, 680], coolCond, coolW);
        flow([970, 680, 1040, 680, 1040, 591], coolCond, coolW);
        // 三通阀出口 → 滤器 → 柴油机滑油入口
        flow([1054, 575, 1120, 575, 1120, 240, 1060, 240], () => anyRun());
        flow([930, 240, 270, 240], () => anyRun());

        this._vv = {
            v1: this._valveMan(d, 460, 590),
            v2: this._valveMan(d, 460, 670),
        };
        this._ck = {
            ck1: this._checkV(d, 620, 590, 0),
            ck2: this._checkV(d, 620, 670, 0),
        };
        this._pp = {
            p1: this._pump(d, 540, 590, 26),
            p2: this._pump(d, 540, 670, 26),
        };
        this._cv = this._cv3(d, 1040, 575);

        // 手动三通转换阀（PT-101 下方）：三三角 + 左侧手柄
        // 手摇泵压力表指针
        this._hpNeedle = new Konva.Line({ points: [892, 89, 892, 56], stroke: '#c0392b', strokeWidth: 2.4, lineCap: 'round', listening: false });
        d.add(this._hpNeedle);

        // 继电器侧压力表指针 + 三通阀手柄
        this._hp2Needle = new Konva.Line({ points: [580, 136, 580, 103], stroke: '#c0392b', strokeWidth: 2, lineCap: 'round', listening: false });
        d.add(this._hp2Needle);
        // 继电器侧三通阀三角（默认上+下通：上、下两片绿；陷入：上+右通：上、右两片绿）
        this._sw3b = { up: null, dn: null, rt: null };
        [[270, 'up'], [90, 'dn'], [0, 'rt']].forEach(([ang, key]) => {
            const n = new Konva.Line({ points: triPts(480, 193, ang), closed: true, fill: '#ffffff', stroke: '#333', strokeWidth: 1.6, lineJoin: 'round', listening: false });
            d.add(n); this._sw3b[key] = n;
        });
        this._sw3bShaft = new Konva.Line({ points: [480, 193, 455, 193], stroke: '#333', strokeWidth: 3, lineCap: 'round', listening: false });
        this._sw3bBar = new Konva.Line({ points: [455, 185, 455, 201], stroke: '#333', strokeWidth: 4, lineCap: 'round', listening: false });
        d.add(this._sw3bShaft, this._sw3bBar);

        this._sw3 = { up: null, dn: null, rt: null };
        [[270, 'up'], [90, 'dn'], [0, 'rt']].forEach(([ang, key]) => {
            const n = new Konva.Line({ points: triPts(786, 146, ang), closed: true, fill: '#ffffff', stroke: '#333', strokeWidth: 1.8, lineJoin: 'round', listening: false });
            d.add(n); this._sw3[key] = n;
        });
        // 手柄：轴自阀芯向左伸出（默认 25px，点击后 15px）+ T 形握条
        this._sw3Shaft = new Konva.Line({ points: [786, 146, 761, 146], stroke: '#333', strokeWidth: 3, lineCap: 'round', listening: false });
        this._sw3Bar = new Konva.Line({ points: [761, 138, 761, 154], stroke: '#333', strokeWidth: 4, lineCap: 'round', listening: false });
        d.add(this._sw3Shaft, this._sw3Bar);

        // 柴油机动态：活塞 / 连杆 / 火焰 / 起停手柄 / 负荷指针
        this._pistons = []; this._rods = []; this._flames = [];
        const ox = 40, oy = 100;
        for (let i = 0; i < 4; i++) {
            const x = ox + 45 + i * 45;
            const p = _rect({ x: x - 18, y: oy + 58, width: 36, height: 16, fill: '#b06f7a', stroke: '#1a5276', strokeWidth: 1.4, cornerRadius: 2 });
            const r = _rect({ x: x - 5, y: oy + 74, width: 10, height: 66, fill: '#ecf0f1', stroke: '#7f8c8d', strokeWidth: 1 });
            const f = new Konva.Path({
                x: x - 15, y: oy + 50, data: 'M15 0 L30 30 Q15 45 0 30 Z',
                fillRadialGradientStartPoint: { x: 15, y: 30 }, fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 15, y: 30 }, fillRadialGradientEndRadius: 30,
                fillRadialGradientColorStops: [0, '#ffff00', 0.5, '#ff6600', 1, 'rgba(255,0,0,0)'],
                opacity: 0, visible: false, listening: false,
            });
            d.add(f, r, p);
            this._pistons.push(p); this._rods.push(r); this._flames.push(f);
        }
        this._engKnob = new Konva.Group({ x: ox + 32, y: oy + 10, rotation: 45, listening: false });
        this._engKnob.add(new Konva.Rect({ x: -2.5, y: -16, width: 5, height: 18, fill: '#2c3e50', cornerRadius: 1 }));
        this._engKnob.add(new Konva.Rect({ x: -1, y: -14, width: 2, height: 5, fill: '#ecf0f1' }));
        d.add(this._engKnob);
        this._fuelPtr = new Konva.Line({ x: ox + 160, y: oy + 15, points: [0, 0, 0, -18], stroke: '#e74c3c', strokeWidth: 3, lineCap: 'round', listening: false });
        d.add(this._fuelPtr);

        // PID 数值（PV 红、SV 绿、OUT 蓝）
        this._pvTx = _text({ x: 706, y: 367, width: 120, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#c0392b', text: '45.0' });
        this._svTx = _text({ x: 706, y: 395, width: 120, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#1e8449', text: '45.0' });
        this._outTx = _text({ x: 706, y: 423, width: 120, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#0d6bb8', text: '55.0' });
        d.add(this._pvTx, this._svTx, this._outTx);
        this._autoBg = _rect({ x: 724, y: 457, width: 56, height: 26, fill: '#2ecc40', cornerRadius: 2 });
        this._manBg = _rect({ x: 662, y: 457, width: 56, height: 26, fill: '#ffffff', cornerRadius: 2 });
        d.add(this._autoBg, this._manBg);
        // 按钮文字放动态层（在高亮块之上，否则会被盖住）
        this._manTx = _text({ x: 662, y: 462, width: 56, align: 'center', fontSize: 13, fill: '#111', text: '手动' });
        this._autoTx = _text({ x: 724, y: 462, width: 56, align: 'center', fontSize: 13, fill: '#111', text: '自动' });
        d.add(this._manTx, this._autoTx);
        // 泵面板灯 + 旋钮
        this._lamps = {}; this._modeKnob = {};
        ['p1', 'p2'].forEach((k, i) => {
            const y = i === 0 ? 110 : 380, x = 1180;
            this._lamps[k] = {
                power: _circle({ x: x + 52, y: y + 52, radius: 12, fill: '#e8ecee', stroke: '#555', strokeWidth: 1.6 }),
                run: _circle({ x: x + 130, y: y + 52, radius: 12, fill: '#e8ecee', stroke: '#555', strokeWidth: 1.6 }),
                ovl: _circle({ x: x + 208, y: y + 52, radius: 12, fill: '#e8ecee', stroke: '#555', strokeWidth: 1.6 }),
                start: _circle({ x: x + 52, y: y + 110, radius: 22, fill: '#2f7d3a' }),
                stop: _circle({ x: x + 130, y: y + 110, radius: 22, fill: '#b33a2b' }),
            };
            Object.values(this._lamps[k]).forEach((c) => d.add(c));
            // 手动/自动旋钮
            const kn = new Konva.Group({ x: x + 208, y: y + 110, listening: false });
            kn.add(_circle({ radius: 25, fill: '#cfd5d7', stroke: '#555', strokeWidth: 1 }));
            kn.add(_circle({ radius: 19, fill: '#3c4245' }));
            kn.add(new Konva.Rect({ x: -2, y: -17, width: 4, height: 17, fill: '#ffffff', cornerRadius: 1 }));
            d.add(kn);
            this._modeKnob[k] = kn;
        });

        this._pressTx = _text({ x: 690, y: 22, width: 192, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#111', text: '0.00 MPa' });
        d.add(this._pressTx);
    }

    // ═══════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const add = (id, x, y, w, h, fn) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (fn) hit.on('click tap', (e) => { e.cancelBubble = true; fn(); this._redraw(); });
            return hit;
        };

        add('engine-switch', 54, 92, 36, 36, () => { this.m.engOn = !this.m.engOn; if (this.m.engOn) this.m.shdTrip = false; });
        add('engine-fuel-up', 200, 93, 22, 44, () => { this.m.fuelRate = Math.min(1, this.m.fuelRate + 0.1); });
        add('engine-fuel-dn', 178, 93, 22, 44, () => { this.m.fuelRate = Math.max(0.1, this.m.fuelRate - 0.1); });
        add('v1', 440, 570, 44, 44, () => { this.m.valves.v1 = !this.m.valves.v1; if (!this.m.valves.v1) this.m.pumps.p1.on = false; });
        add('v2', 440, 650, 44, 44, () => { this.m.valves.v2 = !this.m.valves.v2; if (!this.m.valves.v2) this.m.pumps.p2.on = false; });
        add('p1', 512, 562, 56, 56, () => { const p = this.m.pumps.p1; p.on = !p.on && this.m.valves.v1; });
        add('p2', 512, 642, 56, 56, () => { const p = this.m.pumps.p2; p.on = !p.on && this.m.valves.v2; });
        add('ck1', 600, 570, 40, 40);
        add('ck2', 600, 650, 40, 40);
        add('cv3', 1000, 535, 80, 80);
        add('cv3b', 750, 124, 70, 44, () => { this.m.sw3 = this.m.sw3 === 'pump' ? 'line' : 'pump'; });
        add('hp-up', 1010, 122, 30, 48, () => { this.m.handP = Math.min(1, Math.round((this.m.handP + 0.01) * 100) / 100); });
        add('hp-dn', 980, 122, 30, 48, () => { this.m.handP = Math.max(0, Math.round((this.m.handP - 0.01) * 100) / 100); });
        add('handpump', 976, 176, 70, 18);
        add('cv3c', 445, 171, 64, 44, () => { this.m.sw3b = this.m.sw3b === 'pump' ? 'line' : 'pump'; });
        add('hp2-up', 651, 171, 26, 44, () => { this.m.handP2 = Math.min(1, Math.round((this.m.handP2 + 0.01) * 100) / 100); });
        add('hp2-dn', 625, 171, 26, 44, () => { this.m.handP2 = Math.max(0, Math.round((this.m.handP2 - 0.01) * 100) / 100); });   // 仅名称标签可识别，避免大热区盖住左右半点击区
        add('flt', 930, 200, 130, 80);
        add('cooler', 830, 640, 140, 80);
        add('tank', 60, 590, 220, 120);
        add('engine', 50, 130, 220, 145);
        add('psw', 330, -60, 170, 210);   // 交互层整体下移 60，继电器按绝对坐标定位 → 热区上移 60 对齐
        add('pt', 742, 50, 88, 56);
        add('tt', 1010, 386, 84, 50);
        add('pid', 650, 320, 250, 190);

        add('pid-man', 662, 457, 56, 26, () => { this.m.pid.auto = false; });
        add('pid-auto', 724, 457, 56, 26, () => { this.m.pid.auto = true; });
        add('pid-sv-up', 788, 457, 42, 26, () => {
            const p = this.m.pid;
            if (p.auto) p.sv = Math.min(70, p.sv + 1);      // 自动：增加设定值 SV 1℃
            else p.out = Math.min(100, p.out + 5);          // 手动：增加输出 OUT 5%
        });
        add('pid-sv-dn', 836, 457, 42, 26, () => {
            const p = this.m.pid;
            if (p.auto) p.sv = Math.max(35, p.sv - 1);      // 自动：减少设定值 SV 1℃
            else p.out = Math.max(0, p.out - 5);            // 手动：减少输出 OUT 5%
        });

        ['p1', 'p2'].forEach((k, i) => {
            const y = i === 0 ? 110 : 380, x = 1180;
            add(`pp${i + 1}-start`, x + 30, y + 88, 44, 44, () => {
                const p = this.m.pumps[k];
                if (!p.overload && this.m.valves[k === 'p1' ? 'v1' : 'v2']) p.on = true;
            });
            add(`pp${i + 1}-stop`, x + 108, y + 88, 44, 44, () => { this.m.pumps[k].on = false; });
            add(`pp${i + 1}-mode`, x + 183, y + 85, 50, 50, () => {
                this.m.pumps[k].auto = !this.m.pumps[k].auto;   // 仅切换方式，不自动起泵
            });
        });
    }

    _syncInitial() { try { this.tick(0.016); } catch (e) { /* 忽略首帧异常 */ } }

    _redraw() {
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    //  每帧
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const m = this.m;
        m.t += dt;

        // 运行判定：泵起动 + 支路截止阀导通 + 未过载（面板灯与 MIMIC 泵共用同一判据）
        const vk = (k) => (k === 'p1' ? 'v1' : 'v2');   // 泵 id → 支路截止阀 id
        const running = (k) => m.pumps[k].on && m.valves[vk(k)] && !m.pumps[k].overload;

        // 自动位＝备用：另一台在运行则本泵自动停机
        ['p1', 'p2'].forEach((k) => {
            const other = k === 'p1' ? 'p2' : 'p1';
            if (m.pumps[k].auto && m.pumps[k].on && running(other)) m.pumps[k].on = false;
        });

        // 开关量故障联动：主滑油泵故障（ME-LO-PUMP-F 动作）→ 运行泵过载跳闸，备用泵自动投入
        const kcF = this.sys && this.sys.kchief;
        const pumpFTag = kcF && typeof kcF.tag === 'function' ? kcF.tag('ME-LO-PUMP-F') : null;
        if (pumpFTag && (pumpFTag.value != null ? pumpFTag.value : pumpFTag.normal) >= 0.5) {
            // 只跳正在运行的那台泵（一次），备用泵随后自动投入并保持运行
            if (!this._pumpFaultK) {
                const runK = running('p1') ? 'p1' : (running('p2') ? 'p2' : null);
                if (runK) { m.pumps[runK].overload = true; this._pumpFaultK = runK; }
            }
        } else if (this._pumpFaultK) {
            m.pumps[this._pumpFaultK].overload = false;
            this._pumpFaultK = null;
        }

        // 备用泵自动投入：运行泵过载跳闸时
        ['p1', 'p2'].forEach((k) => {
            const other = k === 'p1' ? 'p2' : 'p1';
            if (m.pumps[k].overload) {
                m.pumps[k].on = false;
                if (m.pumps[other].auto && m.valves[vk(other)] && !m.pumps[other].overload) m.pumps[other].on = true;
            }
        });
        const any = running('p1') || running('p2');
        // 泵出口压力：运行 0.45 MPa；停泵后迅速下降
        m.press += ((any ? 0.45 : 0) - m.press) * Math.min(1, dt / (any ? 0.8 : 0.3));
        // 压力低于 0.3 MPa 且无泵运行 → 备用泵延时 2s 自动起动
        if (!any && m.press < 0.3) {
            m.standbyTimer += dt;
            if (m.standbyTimer >= 2) {
                m.standbyTimer = 0;
                const cand = ['p1', 'p2'].find(k => m.pumps[k].auto && !m.pumps[k].overload && m.valves[vk(k)]);
                if (cand) m.pumps[cand].on = true;
            }
        } else {
            m.standbyTimer = 0;
        }
        // 滤器压降：10 min 内由 0.02 缓慢涨到 0.08
        m.filtUse = Math.min(0.08, 0.02 + (m.t / 600) * 0.06);
        m.inletPress = Math.max(0, m.press - m.filtUse);

        if (m.pid.auto) {
            const err = m.pid.sv - m.pid.pv;
            m.pid.out = Math.max(0, Math.min(100, m.pid.out - err * dt * 0.8));   // 反向：温度高于设定值 → 开大冷却
        }
        m.cv3 = m.pid.out;
        // 滑油温度：主机负荷（燃油/负荷设定）决定发热量，三通调节阀决定冷却量
        //   无冷却时的油温 = 38 + 47 × 负荷（负荷 0.9 → 80 ℃，满负荷 → 85 ℃）
        //   冷却口开度 OUT 越大越冷，OUT=100 % 时降到 40 ℃（冷却器出口温度）
        const load = m.engOn ? m.fuelRate : 0;
        const tNoCool = 38 + 47 * load;
        const tTarget = any ? (40 + (tNoCool - 40) * (1 - m.cv3 / 100)) : 30;
        m.temp += (tTarget - m.temp) * Math.min(1, dt / 4);
        m.pid.pv = m.temp;

        // 滑油温度高 → 延时 6 s 触发主机自动减速；低于 58 ℃ 还原（回差 2 ℃）
        const acSld = this.sys && this.sys.ac600;
        if (acSld && typeof acSld.safetyAction === 'function') {
            if (m.temp > LO_SLD_ON) {
                if (acSld.sldCancelled && !acSld.slowDown) {
                    // Cancel SLD 已取消本次减速（暂停）：不计时、不弹窗；松开后重新开始
                    this._loSldT = 0;
                    this._loPre = false;
                } else {
                    // 越限立即产生预报警（主面板弹出可取消提示框），6 s 延时到才真正减速
                    if (!this._loPre) {
                        this._loPre = true;
                        if (typeof acSld.sldPreAlarm === 'function') acSld.sldPreAlarm('ME-LO-T');
                    }
                    this._loSldT = (this._loSldT || 0) + dt;
                    const loDelay = (typeof acSld.getSafetyDelay === 'function')
                        ? acSld.getSafetyDelay('sld-lo-t', LO_SLD_DELAY) : LO_SLD_DELAY;
                    if (this._loSldT >= loDelay && !this._loSld) {
                        this._loSld = true;
                        acSld.safetyAction('SLD', 'ME-LO-T');
                    }
                }
            } else if (m.temp < LO_SLD_OFF) {
                this._loSldT = 0;
                if (this._loPre) {
                    this._loPre = false;
                    if (typeof acSld.sldPreAlarmClear === 'function') acSld.sldPreAlarmClear('ME-LO-T');
                }
                if (this._loSld) {
                    this._loSld = false;
                    if (typeof acSld.safetyClear === 'function') acSld.safetyClear('SLD', 'ME-LO-T');
                }
            }
        }

        // 柴油机：起停手柄 / 负荷指针 / 活塞 / 火焰
try {
        const eng = m.engOn;
        if (this._engKnob) this._engKnob.rotation(eng ? 45 : -45);
        if (this._fuelPtr) this._fuelPtr.rotation(-90 + (m.fuelRate - 0.1) * 200);
        if (this._pistons) {
            const ph = m.t * (6 + m.fuelRate * 6);
            this._pistons.forEach((p, i) => {
                const dy = eng ? Math.sin(ph + i * 1.6) * 6 : 0;
                p.y(158 + dy);
                this._rods[i].y(174 + dy);
                this._rods[i].height(66 - dy);
                const f = this._flames[i];
                f.visible(eng);
                if (eng) { f.opacity(0.35 + m.fuelRate * 0.5); f.scaleY(0.6 + m.fuelRate * 0.6); }
            });
        }

        } catch (e) { /* 忽略动画异常，保证泵/阀仍刷新 */ }

        // 滑油流动（速度 = 冷却水的 1/2：每帧相位 +1，与 dash 周期 [9,7] 的 16 像素周期对齐）
        this._flowPhase = ((this._flowPhase || 0) + 1) % 16;
        (this._flows || []).forEach((f) => {
            let on = false;
            try { on = !!f.cond(); } catch (e) { on = false; }
            f.node.opacity(on ? 0.95 : 0);
            if (on) {
                f.node.dashOffset(-this._flowPhase);
                f.node.strokeWidth(typeof f.w === 'function' ? Math.max(0.8, f.w()) : f.w);
            }
        });

        // 阀门
        ['v1', 'v2'].forEach((k) => {
            const open = m.valves[k] !== false;
            this._vv[k].a.fill(open ? C_GREEN : '#ffffff');
            this._vv[k].b.fill(open ? C_GREEN : '#ffffff');
        });
        // 单向阀
        [['ck1', 'p1'], ['ck2', 'p2']].forEach(([ck, p]) => {
            this._ck[ck].in.fill(running(p) ? C_GREEN : '#ffffff');
            this._ck[ck].out.fill(C_GRAY);
        });
        // 泵
        ['p1', 'p2'].forEach((k) => {
            const on = running(k);
            this._pp[k].face.fill(on ? '#9ee8a8' : '#ffffff');
            this._pp[k].fan.rotation((this._pp[k].fan.rotation() + (on ? 14 : 0)) % 360);
            this._pp[k].fan.visible(true);
        });

        // 三通阀
        const o = Math.max(0, Math.min(100, m.cv3));
        const blend = (p, q, t) => `rgb(${Math.round(p[0] + (q[0] - p[0]) * t)},${Math.round(p[1] + (q[1] - p[1]) * t)},${Math.round(p[2] + (q[2] - p[2]) * t)})`;
        const WHT = [255, 255, 255], LG = [196, 240, 205], DG = [24, 118, 40];
        const col = o <= 0.5 ? 'rgb(255,255,255)' : (o <= 50 ? blend(WHT, LG, o / 50) : blend(LG, DG, (o - 50) / 50));
        const cool = o / 100, byp = 1 - cool;
        const V = this._cv;
        const setF = (node, ang, ratio) => {
            const k = Math.sqrt(Math.max(0, Math.min(1, ratio)));
            node.points(triPts(V.cx, V.cy, ang, V.A * k, V.B * k));
        };
        setF(V.frt, 0, 1);          // 出口常满
        setF(V.fdn, 90, cool);      // 冷却口 = OUT
        setF(V.flf, 180, byp);      // 旁通口 = 100-OUT
        V.coolTx.text(`冷 ${o.toFixed(0)}%`);
        V.bypTx.text(`旁 ${(100 - o).toFixed(0)}%`);

        // PID
        this._pvTx.text(m.pid.pv.toFixed(1));
        this._svTx.text(m.pid.sv.toFixed(1));
        this._outTx.text(m.pid.out.toFixed(1));
        this._autoBg.fill(m.pid.auto ? '#2ecc40' : '#ffffff');
        this._manBg.fill(m.pid.auto ? '#ffffff' : '#2ecc40');

        // 泵面板
        ['p1', 'p2'].forEach((k) => {
            const p = m.pumps[k], L = this._lamps[k];
            L.power.fill(p.power ? '#ffffff' : '#c8ccc9');
            L.run.fill(running(k) ? '#22d61d' : '#c8ccc9');
            L.ovl.fill(p.overload ? '#8b1a10' : '#c8ccc9');
            this._modeKnob[k].rotation(p.auto ? 45 : -45);
        });

        // 与监视报警系统「主机滑油进机压力 ME-LO-P」关联显示
        const kc = this.sys && this.sys.kchief;
        const tg = kc && typeof kc.tag === 'function' ? kc.tag('ME-LO-P') : null;
        // （压力开关本体为独立组件 psw1，位于 MIMIC 右侧）
        // 三通转换阀：默认上下通（测管路）；点击后上+右通（测手摇泵）
        if (this._sw3) {
            const pumpSel = m.sw3 === 'pump';
            this._sw3.up.fill('#2ecc40');
            this._sw3.dn.fill(pumpSel ? '#ffffff' : '#2ecc40');
            this._sw3.rt.fill(pumpSel ? '#2ecc40' : '#ffffff');
            const len = pumpSel ? 15 : 25;
            const ex = 786 - len;
            this._sw3Shaft.points([786, 146, ex, 146]);
            this._sw3Bar.points([ex, 138, ex, 154]);
        }
        if (this._hpNeedle) {
            const a = (-135 + Math.max(0, Math.min(1, m.handP)) * 270) * Math.PI / 180;
            this._hpNeedle.points([892, 89, 892 + Math.sin(a) * 33, 89 - Math.cos(a) * 33]);
        }
        if (this._hp2Needle) {
            const a2 = (-135 + Math.max(0, Math.min(1, m.handP2)) * 270) * Math.PI / 180;
            this._hp2Needle.points([580, 136, 580 + Math.sin(a2) * 33, 136 - Math.cos(a2) * 33]);
        }
        // 手摇泵手柄随压力转动
        const ha = (-60 + Math.max(0, Math.min(1, m.handP)) * 120) * Math.PI / 180;
        if (this._hpHandle1) this._hpHandle1.points([1010, 146, 1010 + Math.cos(ha) * 36, 146 + Math.sin(ha) * 36]);
        const ha2 = (-60 + Math.max(0, Math.min(1, m.handP2)) * 120) * Math.PI / 180;
        if (this._hpHandle2) this._hpHandle2.points([651, 193, 651 + Math.cos(ha2) * 36, 193 + Math.sin(ha2) * 36]);
        // 继电器侧三通阀（独立状态）：手柄轴 25/15px
        const sel2 = m.sw3b === 'pump';
        if (this._sw3b) {
            this._sw3b.up.fill('#2ecc40');
            this._sw3b.dn.fill(sel2 ? '#ffffff' : '#2ecc40');
            this._sw3b.rt.fill(sel2 ? '#2ecc40' : '#ffffff');
        }
        if (this._sw3bShaft) {
            const len2 = sel2 ? 15 : 25;
            this._sw3bShaft.points([480, 193, 480 - len2, 193]);
            this._sw3bBar.points([480 - len2, 185, 480 - len2, 201]);
        }
        // 压力继电器固定在 MIMIC 上：每帧跟随 MIMIC 位移
        const prg = this.sys && this.sys.comps && this.sys.comps.psw1;
        if (prg && prg.group) {
            prg.group.x(this.group.x() + 330);
            prg.group.y(this.group.y() + 0);
        }
        const measured = m.sw3 === 'pump' ? m.handP : m.inletPress;
        this._pressTx.text(`${measured.toFixed(2)} MPa`);
        // 监视报警系统的滑油压力取自 PT-101 的测量值（三通阀在右位时即为手摇泵压力）
        if (tg) tg.normal = measured;
        // 驱动独立压力开关组件（PressRelay）
        // 取压来自继电器下方的手动三通阀（独立于 PT-101 侧）：
        //   上下通（line，初始）→ 滤器出口压力；上右通（pump，按下后）→ 手摇泵出口压力
        const pr = this.sys && this.sys.comps && this.sys.comps.psw1;
        const relayP = (m.sw3b === 'pump') ? m.handP2 : m.inletPress;
        if (pr && typeof pr.update === 'function') pr.update(relayP);
        // 监视与报警系统：滑油低压开关（ME-LO-PR-SW）采集压力继电器 NC 触点的通断状态
        //   压力低于给定值 → NC 闭合（开关动作 = 低压报警）；高于给定值+幅差 → NO 闭合（正常）
        const prSw = kc && typeof kc.tag === 'function' ? kc.tag('ME-LO-PR-SW') : null;
        if (prSw && pr) {
            prSw.normal = (typeof pr.getSwitchOutput === 'function') ? pr.getSwitchOutput() : (pr.isEnergized ? 1 : 0);
        }
        // 主机安保停车：压力继电器 NC 触点闭合（压力低）→ 报警系统的安保延时（6 s）到且未被越控
        // → 执行 SHD，主机自动停车（起动手柄回到停止位；重新起动手柄即复位该标志）
        if (this._shdCnt == null) this._shdCnt = 0;
        const shdCnt = (kc && Array.isArray(kc.safetyActions))
            ? kc.safetyActions.filter(a => a.tagId === 'ME-LO-PR-SW').length : 0;
        if (shdCnt > this._shdCnt) {
            this._shdCnt = shdCnt;
            m.engOn = false;
            m.shdTrip = true;
        }
        // 安保停车标志跟随主机遥控模型：**驾控台把车钟拉回 STOP 复位自动停车后，
        // 这里的 shdTrip 也一并复归**，报警系统的「M/E SAFETY SHUTDOWN ACTIVE」随之恢复
        const acM = this.sys && this.sys.ac600;
        if (acM && typeof acM.shutDown === 'boolean') m.shdTrip = !!acM.shutDown;
        // 「主机安全保护动作」开关量：安保停车期间动作
        const shdnTag = kc && typeof kc.tag === 'function' ? kc.tag('ME-GEN-SHDN') : null;
        if (shdnTag) shdnTag.normal = m.shdTrip ? 1 : 0;
        // 压力开关：入口压力低于给定值 → 触点断开（报警），高于给定值+幅差 → 复位
        const sp = m.psw.sp, diff = m.psw.diff;
        if (m.inletPress < sp) m.pswClosed = false;
        else if (m.inletPress > sp + diff) m.pswClosed = true;
        if (false) {
            const on = m.pswClosed !== false;
            const c = on ? '#2ecc40' : '#c0392b';
            this._pswC1.fill(c); this._pswC2.fill(c);
            this._pswArm.points(on ? [262, 190, 226, 130] : [262, 190, 290, 150]);
            this._pswArm.stroke(on ? '#1e6ab6' : '#c0392b');
            this._pswLever.rotation(on ? 0 : 2.5);
        }
        // 滑油温度：TT-101 读数写入监视报警系统 ME-LO-T（主机滑油进机温度）
        if (kc && typeof kc.tag === 'function') {
            const tt = kc.tag('ME-LO-T');
            if (tt) tt.normal = m.temp;
        }

        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }
}
