import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { ac600Of, TELEGRAPH, CONTROL_POS } from '../tools/AC600Solver.js';

/**
 * Ac600LocalPanel — 主机遥控系统机旁操纵面板（Local Control Panel with Engine Telegraph）
 * ═══════════════════════════════════════════════════════════════
 *  1600 × 800 一屏三区：
 *    左：黑色机旁操纵板
 *        · 左列圆钮：At Sea / Stand By / FWE、Bridge / ECR / Local、Wrong Way / Lamp Test
 *        · 右列车钟档位：Nav.Full … Emp. Astern（11 档）
 *    中：控制方式与状态指示矩阵（4 列 × 5 行色块）、试灯、EM STOP、冲车/慢转起动旋钮、
 *        STOP | AHEAD | ASTERN 车钟刻度大表盘
 *    右：三只机旁仪表（起动空气压力 / 主机转速 / 动力液压油压力）
 *        + 盘车机遥控盒（电源 / 正转 / 倒转 / 紧急停止）
 *        + 盘车机控制箱（电源开关、电流表、4×3 指示灯矩阵、加热断/通）
 *
 *  逻辑（全部读写 sys.ac600 共享模型）：
 *    · 控制位置三处互斥：Bridge / ECR / Local；只有当前控制位置能操车钟
 *    · 「控制权强制获取」= 机旁强抢控制权
 *    · 盘车机未脱开 / 空气分配器不在工作位 / 主起动阀不在工作位 → 禁止起动（起动阻塞）
 *    · 主机备车未完成、起动失败、负荷限制、慢降/停车 等状态在矩阵上指示
 *
 *  部件 id（工作流 subTarget / op.part）：
 *    mode-atsea mode-standby mode-fwe
 *    pos-bridge pos-ecr pos-local  force-take  lamp-test  wrong-way
 *    tel-0 … tel-10
 *    mx-local mx-ecr mx-bridge mx-force
 *    mx-sld-req mx-sld-act mx-sld-cancel mx-sld-reset
 *    mx-sd-act mx-sd-cancel mx-blower-run mx-blower-alarm
 *    mx-turn-out mx-air-dist mx-main-valve mx-not-ready
 *    mx-lim-act mx-lim-up mx-start-block mx-start-fail
 *    em-stop  start-auto  slow-turn  blow  test-lamp
 *    tg-power tg-fwd tg-rev tg-estop  tg-power-knob tg-sel tg-heat tg-jog-fwd tg-jog-rev tg-lamp-test
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1500, H = 800;   // 右侧空白截掉（右块右沿 1471 + 留白）

/** 黑色机旁操纵板：宽 390（车钟列一侧收 30 px），两列按钮中心 */
const BOARD_W = 390;
const COL_LEFT = 112;     // 左列（工况 / 位置 / 其他）圆钮中心 x（半径 33）
const COL_TEL = 290;     // 右列（车钟 11 档）圆钮中心 x（半径 29）
const TEL_Y0 = 60;       // 车钟首档（Nav.Full）中心 y（外框距上下边各 15 px）
const TEL_STEP = 70;     // 档距（11 档对称分布）
const BOARD_H = 804;     // 黑色操纵板高度（原 784 + 20）

/** 左列三组按钮（x=92）：组内间距 8px（圆钮直径 68 → 中心距 76） */
const LEFT_BTNS = [
    ['mode-atsea', 'At Sea', 65, 'sea'],
    ['mode-standby', 'Stand By', 141, 'standby'],
    ['mode-fwe', 'FWE', 217, 'fwe'],
    ['pos-bridge', 'Bridge', 334, 'bridge'],
    ['pos-ecr', 'ECR', 410, 'ecr'],
    ['pos-local', 'Local', 486, 'local'],
    ['spare-1', '', 603, 'spare'],
    ['wrong-way', 'Wrong Way', 679, 'wrong'],
    ['lamp-test', 'Lamp Test', 755, 'lamp'],
];

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Arial, Microsoft YaHei' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_PANEL = '#1b1d1f';
const C_FRAME = '#3a3d40';
const C_LABEL = '#c9ccce';
const C_GREEN = '#00d24a';
const C_GREEN_D = '#134a1f';
const C_RED = '#ea1212';
const C_RED_D = '#4e1111';
const C_AMBER = '#c8a800';
// 指示灯颜色：不点亮 = 暗白；点亮 = 亮黄 / 亮绿 / 亮红 / 亮白
const C_LAMP_OFF = '#c8cccc';   // 暗白（未点亮）
const C_LAMP_W = '#ffffff';     // 亮白
const C_LAMP_G = '#46ff7d';     // 亮绿
const C_LAMP_A = '#fff23c';     // 亮黄
const C_LAMP_R = '#ff4d4d';     // 亮红
const C_BLUE_BOX = '#bcd6d8';

/** 机旁三只仪表：矩形黑边框表盘 */
const GAUGE_Y = 25, GAUGE_W = 186, GAUGE_H = 165;

/** 右侧整块（三只仪表 + 盘车机遥控盒/控制箱）整体左移量（90 + 35） */
const RX = -125;

/** 状态矩阵：4 列 × 5 行**方形按钮**（宽 = 高 = 58，高度保持原值），按钮之间黑色分隔 */
const MX_X0 = 472, MX_Y0 = 12;
const MX_W = 74, MX_H = 70;       // 按钮宽高（原 71 × 69，宽 +3、高 +1）
const MX_GAP = 6;                 // 按钮之间的黑色分隔缝（原 4 px × 1.5）
const MX_LINE = 1.5;              // 分隔/描边线宽（原 1 px × 1.5）
const MX_PW = MX_W + MX_GAP;      // 列距 80
const MX_PH = MX_H + MX_GAP;      // 行距 76


/** 调速旋钮大表盘：中心与矩阵按钮的中间对齐，刻度 −135°…+135° */
const DIAL_CX = 629, DIAL_CY = 690, DIAL_R = 96;
const DIAL_MAX = 135;

/** 亮/暗配对：不亮用暗色，点亮用亮色 */
const DIM_OF = {
    [C_GREEN]: C_GREEN_D,
    [C_RED]: C_RED_D,
    [C_LAMP_R]: '#761d1d',      // 暗红
    [C_LAMP_A]: '#6a5f00',      // 暗黄
    [C_LAMP_W]: C_LAMP_OFF,     // 暗白
};

/** 矩阵一格：color = 点亮色，dim = 不亮色（按色系自动取暗色），alarm = 未确认时闪烁 */
const mx = (id, text, color, key, alarm) => ({
    id, text, color, key,
    dim: DIM_OF[color] || C_GREEN_D,
    alarm: (alarm !== undefined) ? alarm : (color === C_RED),
});

/** 矩阵：4 列 × 5 行（每格文字 / 亮灯颜色 / 状态键） */
const MATRIX = [
    [
        mx('mx-local', '本地\n控制', C_LAMP_R, 'local', false),        // 红：不亮暗红、亮亮红
        mx('mx-ecr', '集控室\n控制', C_LAMP_A, 'ecr', false),          // 黄：不亮暗黄、亮亮黄
        mx('mx-bridge', '驾驶台\n控制', C_GREEN, 'bridge'),
        mx('mx-force', '控制权\n强制获取', C_RED, 'force'),
    ],
    [
        mx('mx-sld-req', '手动\n降速\n请求', C_RED, 'sldReq', false),
        mx('mx-sld-act', '降速\n激活', C_RED, 'sldAct', false),
        mx('mx-sld-cancel', '降速\n取消', C_RED, 'sldCancel', false),
        mx('mx-sld-reset', '降速\n复位', C_RED, 'sldReset', false),
    ],
    [
        mx('mx-sd-act', '停车\n激活', C_RED, 'sdAct', false),
        mx('mx-sd-cancel', '停车\n取消', C_RED, 'sdCancel'),
        mx('mx-blower-run', '辅助鼓风机\n运行', C_GREEN, 'blowerRun'),
        mx('mx-blower-alarm', '辅助鼓风机\n报警', C_RED, 'blowerAlarm'),
    ],
    [
        mx('mx-turn-out', '盘车机\n脱开', C_GREEN, 'turnOut'),
        mx('mx-air-dist', '空气分配器\n在工作位', C_GREEN, 'airDist'),
        mx('mx-main-valve', '主起动阀\n在工作位', C_GREEN, 'mainValve'),
        mx('mx-not-ready', '主机备车\n未完成', C_RED, 'notReady', false),
    ],
    [
        mx('mx-lim-act', '负荷限制\n激活', C_LAMP_W, 'limAct', false),  // 白：不亮暗白、亮亮白
        mx('mx-lim-up', '负荷限制\n增高', C_LAMP_W, 'limUp', false),    // 白：不亮暗白、亮亮白
        mx('mx-start-block', '起动\n阻塞', C_RED, 'startBlock', false),
        mx('mx-start-fail', '起动\n失败', C_RED, 'startFail'),
    ],
];

/** 点亮时用深色文字的亮灯色（浅底） */
const DARK_TEXT = new Set([C_GREEN, C_LAMP_G, C_LAMP_A, C_LAMP_W]);

/** 不亮时底色偏亮（暗白）→ 文字用深色，否则灰字看不清 */
const DIM_DARK_TEXT = new Set([C_LAMP_OFF]);

/** 盘车机控制箱指示灯（4 列 × 3 行） */
const TG_LAMPS = [
    ['过载', '#ff3b3b', '#8a1e1e', 'overload', 0, 0],      // 红
    ['电源', '#3cff66', '#1f7a34', 'power', 1, 0],         // 绿
    ['空间加热', '#5a94ff', '#2a4a8c', 'heater', 2, 0],    // 蓝
    ['正转', '#3cff66', '#1f7a34', 'fwd', 0, 1],           // 绿
    ['倒转', '#3cff66', '#1f7a34', 'rev', 1, 1],           // 绿
    ['遥控', '#ff9a3c', '#8a4c14', 'remote', 2, 1],        // 橙红
    ['本地控制', '#fff23c', '#8a7c14', 'local', 3, 1],     // 黄
];

export class Ac600LocalPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;
        this.type = 'ac600_local';
        this.cache = 'fixed';

        this.model = ac600Of(sys);
        this.posKey = CONTROL_POS.LOCAL;      // 本面板位置（控制权转移用）

        this._cells = {};        // 矩阵格子：id → { rect, text, color }
        this._tgLamps = [];      // 盘车机指示灯

        // 两套灯测试互相独立：
        //  · _ltBoard —— 左列「Lamp Test」圆钮：只点亮黑色操纵板上的 20 个灯（9 圆钮 + 11 档车钟）
        //  · _ltPanel —— 中部「试灯」按钮：只点亮右侧状态矩阵的 16 个指示灯（4 个操作按钮格不参与）
        this._ltBoard = false;
        this._ltPanel = false;
        this._gauges = {};

        this._initGroups();
        this._init();

        this.config = { id: this.id };
    }

    /** 机旁面板操作一律不弹浮动提示（只靠指示灯与面板状态反馈） */
    _tip() { /* 面板式操作：不弹提示 */ }

    _redraw() {
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _init() {
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
        this._addDragPlate();
    }

    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
    }

    // ═══════════════════════════════════════════════════════
    //  静态图形
    // ═══════════════════════════════════════════════════════

    /** 机旁操纵板：黑色底板 + 带指示灯的圆钮 */
    _drawLocalBoard(s) {
        s.add(_rect({ x: 6, y: 8, width: BOARD_W, height: BOARD_H, fill: C_PANEL, stroke: '#0b0c0d', strokeWidth: 2, cornerRadius: 16 }));

        // 每组按钮外围绕白色圆角外框（左列三组 + 车钟 11 档一组）
        const frame = (x, y, w, h) => s.add(_rect({
            x, y, width: w, height: h, cornerRadius: 22,
            stroke: '#ffffff', strokeWidth: 2, fill: 'rgba(0,0,0,0)',
        }));
        frame(COL_LEFT - 42, 23, 84, 236);        // 组1：At Sea / Stand By / FWE
        frame(COL_LEFT - 42, 292, 84, 236);      // 组2：Bridge / ECR / Local
        frame(COL_LEFT - 42, 561, 84, 236);      // 组3：备用（无字）/ Wrong Way / Lamp Test
        frame(COL_TEL - 38, 23, 76, 774);        // 车钟 11 档（与左列同跨距 23…797）

        // 左列：三组按钮（组内间距 8px：直径 68 → 中心距 76）
        LEFT_BTNS.forEach(([id, label, y]) => {
            s.add(_circle({ x: COL_LEFT, y, radius: 33, fill: '#2a2d30', stroke: '#f2f4f5', strokeWidth: 3 }));
            const fs = (label.length > 7) ? 14.5 : 16;
            s.add(_text({
                x: COL_LEFT - 33, y: y - (label.includes(' ') ? 16 : 9), width: 66, align: 'center',
                fontSize: fs, fontStyle: 'bold', lineHeight: 1.15, fill: '#e8ebec', text: label.includes(' ') ? label.replace(' ', '\n') : label,
            }));
            void id;
        });

        // 右列：车钟档位
        TELEGRAPH.forEach((t, i) => {
            const y = TEL_Y0 + i * TEL_STEP;
            s.add(_circle({ x: COL_TEL, y, radius: 29, fill: '#2a2d30', stroke: '#f2f4f5', strokeWidth: 3 }));
            const label = t.label.replace('. ', '.\n').replace('Emp. Astern', 'Emp.\nAstern');
            s.add(_text({
                x: COL_TEL - 29, y: y - 18, height: 36, verticalAlign: 'middle', width: 58, align: 'center',
                fontSize: 15, fontStyle: 'bold', lineHeight: 1.12, fill: '#e8ebec', text: label,
            }));
        });
    }

    /** 中部：状态矩阵 4×5 */
    _drawMatrix(s) {
        // 底板（黑色 = 按钮之间的分隔缝颜色）
        s.add(_rect({
            x: MX_X0 - MX_GAP / 2, y: MX_Y0 - MX_GAP / 2,
            width: 3 * MX_PW + MX_W + MX_GAP, height: 4 * MX_PH + MX_H + MX_GAP,
            fill: '#000000', stroke: '#000000', strokeWidth: MX_LINE,
        }));
        MATRIX.forEach((row, r) => {
            row.forEach((cell, c) => {
                const x = MX_X0 + c * MX_PW, y = MX_Y0 + r * MX_PH;
                s.add(_rect({
                    x, y, width: MX_W, height: MX_H,
                    fill: cell.dim, stroke: '#000000', strokeWidth: MX_LINE,
                }));
                s.add(_text({
                    x: x + 2, y, width: MX_W - 4, height: MX_H,
                    align: 'center', verticalAlign: 'middle',
                    fontSize: 14, lineHeight: 1.12, fill: '#101010', text: cell.text,
                }));
            });
        });
    }

    /** 中部：试灯 / EM STOP / 冲车-慢转起动旋钮 */
    _drawSwitches(s) {
        // 试灯
        s.add(_rect({ x: 472, y: 400, width: 74, height: 74, fill: '#c9ccce', stroke: '#6f7679', strokeWidth: 2 }));
        s.add(_text({ x: 472, y: 429, width: 74, align: 'center', fontSize: 15, fill: '#111111', text: '试灯' }));
        // EM STOP（红色蘑菇头，带可上翻外盖）
        s.add(_rect({ x: 472, y: 480, width: 74, height: 74, fill: '#3c3f42', stroke: '#1f2225', strokeWidth: 2 }));
        // 白色金属外框（护圈）+ 内凹阴影圈；红色按钮帽在动态层绘制（按下陷进 / 弹出复位）
        s.add(_circle({ x: 509, y: 517, radius: 32, fill: '#d9dde0', stroke: '#8b9397', strokeWidth: 2 }));
        s.add(_circle({ x: 509, y: 517, radius: 28, fill: '#aab1b4', stroke: '#767d80', strokeWidth: 1 }));
        s.add(_circle({ x: 509, y: 517, radius: 25, fill: '#33373a', stroke: '#22262a', strokeWidth: 1 }));
        s.add(_text({ x: 472, y: 558, width: 74, align: 'center', fontSize: 10, fill: '#e8b4b8', text: 'EM STOP' }));

        // 冲车 / 自动 / 慢转起动：三档转换开关（左=冲车，中=自动，右=慢转起动）
        s.add(_rect({ x: 610, y: 400, width: 176, height: 154, fill: '#cfe3e4', stroke: '#5f7a7c', strokeWidth: 2 }));
        s.add(_text({ x: 664, y: 407, width: 68, align: 'center', fontSize: 14, fill: '#12324a', text: '自动' }));
        s.add(_text({ x: 730, y: 420, width: 56, align: 'center', fontSize: 13.5, fill: '#12324a', text: '慢转\n起动' }));
        s.add(_text({ x: 606, y: 432, width: 56, align: 'center', fontSize: 14, fill: '#12324a', text: '冲车' }));
        // 旋钮底座 + 三档刻度
        s.add(_circle({ x: 698, y: 488, radius: 52, fill: '#2a2d30', stroke: '#0f1112', strokeWidth: 2 }));
        s.add(_circle({ x: 698, y: 488, radius: 22, fill: '#4a4f53', stroke: '#0f1112', strokeWidth: 2 }));
        [-60, 0, 60].forEach((deg) => {
            const a = (deg - 90) * Math.PI / 180;
            s.add(_line({
                points: [698 + Math.cos(a) * 56, 488 + Math.sin(a) * 56, 698 + Math.cos(a) * 66, 488 + Math.sin(a) * 66],
                stroke: '#12324a', strokeWidth: 2,
            }));
        });

        // 调速旋钮大表盘：STOP 正上 / AHEAD 最右 / ASTERN 最左，刻度 −135°…+135°
        const cx = DIAL_CX, cy = DIAL_CY, R = DIAL_R;
        s.add(_circle({ x: cx, y: cy, radius: R + 12, fill: '#f7f7f7', stroke: '#2a2d30', strokeWidth: 4 }));
        s.add(_circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#8d9498', strokeWidth: 1 }));
        // STOP：正上方，比原来上移 5 px
        s.add(_text({ x: cx - 40, y: cy - R - 29, width: 80, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#c40000', text: 'STOP' }));
        // AHEAD 弧端（最右） / ASTERN 弧端（最左）
        s.add(_text({ x: cx + 78, y: cy + R - 28, width: 92, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#12324a', text: 'AHEAD' }));
        s.add(_text({ x: cx - 170, y: cy + R - 28, width: 92, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#12324a', text: 'ASTERN' }));
        // 刻度：左右各 0…10，跨 −135°…+135°
        for (let i = 0; i <= 10; i++) {
            const deg = (i / 10) * DIAL_MAX;
            [deg, -deg].forEach((dg) => {
                const a = (dg - 90) * Math.PI / 180;                 // 0° = 正上
                const r1 = R - 12, r2 = R - 2;
                s.add(_line({
                    points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2],
                    stroke: '#2a2d30', strokeWidth: i % 5 === 0 ? 2 : 1.2,
                }));
                if (i % 2 === 0) {
                    const rn = R - 24;                                // 数字环半径（旋钮不会遮住）
                    s.add(_text({
                        x: cx + Math.cos(a) * rn - 9, y: cy + Math.sin(a) * rn - 9, width: 18, height: 18,
                        align: 'center', verticalAlign: 'middle',
                        fontSize: 13, fill: '#2a2d30', text: String(i),
                    }));
                }
            });
        }
        // 旋钮（可用鼠标按住拖动旋转）
        s.add(_circle({ x: cx, y: cy, radius: 30, fill: '#141618', stroke: '#000000', strokeWidth: 2 }));
        s.add(_circle({ x: cx, y: cy, radius: 26, fill: '#2b2f33', stroke: '#7d8488', strokeWidth: 1.5 }));
    }

    /** 右区：三只机旁仪表（黑边框 + 白面 + 数字框 + 右下黑旋塞，照真机） */
    _drawGauges(s) {
        s.add(_rect({ x: 1006, y: 3, width: 590, height: 201, fill: C_BLUE_BOX, stroke: '#4f7375', strokeWidth: 2 }));
        s.add(_text({ x: 1017, y: 7, width: 186, align: 'center', fontSize: 12.5, fill: '#12324a', text: '启动空气压力' }));
        s.add(_text({ x: 1207, y: 7, width: 186, align: 'center', fontSize: 12.5, fill: '#12324a', text: '主机转速' }));
        s.add(_text({ x: 1397, y: 7, width: 186, align: 'center', fontSize: 12.5, fill: '#12324a', text: '动力液压油压力' }));

        this._staticDial(s, { x: 1017, lo: 0, hi: 40, unit: 'bar', redFrom: 0, redTo: 10 });
        this._staticDial(s, { x: 1207, lo: -120, hi: 120, unit: 'rpm', redOuter: true });
        this._staticDial(s, { x: 1397, lo: 0, hi: 400, unit: 'bar', greenTo: 320 });
    }

    /** 单只仪表（黑边框矩形表 + 白面 + 弧形刻度 + 数字框 + 右下黑旋塞） */
    _staticDial(s, o) {
        const x = o.x, y = GAUGE_Y, w = GAUGE_W, h = GAUGE_H;
        const { lo, hi, unit } = o;
        // 黑色边框 + 白色表盘
        s.add(_rect({ x, y, width: w, height: h, fill: '#26292c', stroke: '#0d0f10', strokeWidth: 3, cornerRadius: 8 }));
        s.add(_rect({ x: x + 7, y: y + 7, width: w - 14, height: h - 14, fill: '#fbfbfb', stroke: '#8d9498', strokeWidth: 1, cornerRadius: 6 }));

        const cx = x + w / 2, cy = y + h - 64, R = 73;   // 弧/刻度/指针下移 20，半径 68 → 73
        const arc = (rot, ang, ri, ro, fill) => new Konva.Arc({
            x: cx, y: cy, innerRadius: ri, outerRadius: ro, angle: Math.max(0.01, ang), rotation: rot, fill, listening: false,
        });
        const pct = (v) => (v - lo) / (hi - lo);
        s.add(arc(180, 180, R - 9, R, '#d8d8d8'));
        if (o.redOuter) {                       // 转速：|60| 以外红、以内绿
            s.add(arc(180, pct(-60) * 180, R - 9, R, C_RED));
            s.add(arc(180 + pct(-60) * 180, (pct(60) - pct(-60)) * 180, R - 9, R, C_GREEN));
            s.add(arc(180 + pct(60) * 180, (1 - pct(60)) * 180, R - 9, R, C_RED));
        } else if (o.redFrom != null) {
            s.add(arc(180 + pct(o.redFrom) * 180, (pct(o.redTo) - pct(o.redFrom)) * 180, R - 9, R, C_RED));
            s.add(arc(180 + pct(o.redTo) * 180, (1 - pct(o.redTo)) * 180, R - 9, R, C_GREEN));
        } else if (o.greenTo != null) {
            s.add(arc(180, pct(o.greenTo) * 180, R - 9, R, C_GREEN));
            s.add(arc(180 + pct(o.greenTo) * 180, (1 - pct(o.greenTo)) * 180, R - 9, R, '#c9ccce'));
        } else {
            s.add(arc(180, 180, R - 9, R, C_GREEN));
        }
        // 刻度线
        for (let i = 0; i <= 24; i++) {
            const a = Math.PI + (i / 24) * Math.PI;
            const major = i % 6 === 0;
            const r1 = R - 9 - (major ? 9 : 4);
            s.add(_line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)],
                stroke: '#2a2d30', strokeWidth: major ? 1.6 : 0.9,
            }));
        }
        // 数字
        for (let i = 0; i < 5; i++) {
            const t = i / 4;
            const a = Math.PI + t * Math.PI;
            s.add(_text({
                x: cx + Math.cos(a) * (R - 22) - 18, y: cy + Math.sin(a) * (R - 22) - 8, width: 36, align: 'center',
                fontSize: 10.5, fill: '#2a2d30', text: String(Math.round(lo + (hi - lo) * t)),
            }));
        }
        // 单位 + 右上角 ▽R 标记
        s.add(_text({ x: x + 13, y: y + 11, width: 56, fontSize: 12, fill: '#12324a', text: unit }));
        s.add(_text({ x: x + w - 40, y: y + 11, width: 30, align: 'center', fontSize: 9, fill: '#5f6669', text: '▽R' }));
        // 数字框（白色，水平居中，较原来下移 15 px）+ 下方小标记
        const boxW = 74, boxX = x + (w - boxW) / 2;
        s.add(_rect({ x: boxX, y: y + 127, width: boxW, height: 22, fill: '#ffffff', stroke: '#2a2d30', strokeWidth: 1.5, cornerRadius: 2 }));
        s.add(_text({ x: boxX, y: y + 151, width: boxW, align: 'center', fontSize: 7, fill: '#5f6669', text: '⊙-1.5|☆' }));
        // 右下黑色旋塞
        s.add(_circle({ x: x + w - 34, y: y + h - 30, radius: 12, fill: '#2a2d30', stroke: '#9aa0a0', strokeWidth: 1.5 }));
        s.add(_circle({ x: x + w - 34, y: y + h - 30, radius: 4, fill: '#6f7679' }));
    }

    /** 右下：盘车机遥控盒（黄色）+ 盘车机控制箱（浅蓝） */
    _drawTurningGear(s) {
        // 遥控盒
        s.add(_rect({ x: 1006, y: 236, width: 120, height: 556, fill: '#f0c14b', stroke: '#a07a10', strokeWidth: 2, cornerRadius: 4 }));
        s.add(_text({ x: 1006, y: 244, width: 120, align: 'center', fontSize: 13, fill: '#3a2c00', text: '盘车机遥控盒' }));
        [['tg-power', '电源', 345, '#f2f2f2'], ['tg-fwd', '正转', 501, '#111111'], ['tg-rev', '倒转', 614, '#111111'], ['tg-estop', '紧急停止', 727, '#c8232c']]
            .forEach(([id, label, y, fill]) => {
                s.add(_text({ x: 1006, y: y - 46, width: 120, align: 'center', fontSize: 12.5, fill: '#3a2c00', text: label }));
                if (id === 'tg-fwd' || id === 'tg-rev') {
                    // 带灯按钮：白色外框 r=30（芯为动态，按下点亮）
                    s.add(_circle({ x: 1066, y, radius: 30, fill: '#e9edf0', stroke: '#9aa0a0', strokeWidth: 2 }));
                } else {
                    s.add(_circle({ x: 1066, y, radius: 30, fill: '#2a2d30', stroke: '#7a5f10', strokeWidth: 2 }));
                    if (id === 'tg-power') {
                        // 电源按钮芯：动态指示灯（电源接通亮白、断开变暗）
                    } else {
                        s.add(_circle({ x: 1066, y, radius: 24, fill, stroke: '#7a5f10', strokeWidth: 1 }));
                    }
                }
                void id;
            });

        // 控制箱
        s.add(_rect({ x: 1136, y: 236, width: 460, height: 556, fill: C_BLUE_BOX, stroke: '#4f7375', strokeWidth: 2, cornerRadius: 4 }));
        s.add(_text({ x: 1136, y: 242, width: 460, align: 'center', fontSize: 16, fontStyle: 'bold', fill: '#12324a', text: '盘车机控制箱' }));
        s.add(_text({ x: 1560, y: 244, width: 28, align: 'center', fontSize: 11, fill: '#12324a', text: '3D' }));

        // 电源开关：黑色底板 + 大圆旋钮（ON 上 / OFF 下，白指示条斜向 ON）
        s.add(_rect({ x: 1173.5, y: 291, width: 124, height: 108, fill: '#3a3d40', stroke: '#1f2225', strokeWidth: 2, cornerRadius: 3 }));
        s.add(_rect({ x: 1175.5, y: 293, width: 46, height: 30, fill: '#2f4a34', stroke: '#1f2225', strokeWidth: 1 }));
        s.add(_text({ x: 1177.5, y: 296, width: 40, height: 20, fontSize: 13, fontStyle: 'bold', align: 'center', fill: '#a6ffa6', text: 'ON' }));
        s.add(_rect({ x: 1175.5, y: 365, width: 46, height: 30, fill: '#4a2f2f', stroke: '#1f2225', strokeWidth: 1 }));
        s.add(_text({ x: 1177.5, y: 370, width: 40, height: 20, fontSize: 13, fontStyle: 'bold', align: 'center', fill: '#ffb0b0', text: 'OFF' }));
        s.add(_circle({ x: 1251, y: 345, radius: 36, fill: '#1a1c1e', stroke: '#0a0c0d', strokeWidth: 2 }));
        s.add(_circle({ x: 1251, y: 339, radius: 28, fill: '#2b2f33', stroke: '#7d8488', strokeWidth: 1.2 }));
        s.add(_circle({ x: 1251, y: 339, radius: 34, fill: 'rgba(0,0,0,0)', stroke: '#e6ebee', strokeWidth: 2.5, listening: false }));
        [-45, -135].forEach((deg) => {   // ON 偏左 45° / OFF 偏左 135°
            const a = (deg - 90) * Math.PI / 180;
            s.add(_line({
                points: [1251 + Math.cos(a) * 37, 339 + Math.sin(a) * 37, 1251 + Math.cos(a) * 44, 339 + Math.sin(a) * 44],
                stroke: '#e6ebee', strokeWidth: 2,
            }));
        });
        s.add(_circle({ x: 1251, y: 339, radius: 6, fill: '#1a1c1e' }));

        // 电流表：与上方三只表同款（黑边框 + 白面 + 弧形刻度 + 数字框 + ▽R + 右下黑旋塞）
        // 右边缘与右列按钮外沿对齐（1558.5）
        const aw = 188, ah = 118, ax = 1558.5 - aw, ay = 287;   // 宽度 +20，右沿仍与右列按钮对齐
        const acx = ax + aw / 2, acy = ay + ah - 38, aR = 62;   // 弧/刻度/指针上移 10，半径 +20
        s.add(_rect({ x: ax, y: ay, width: aw, height: ah, fill: '#26292c', stroke: '#0d0f10', strokeWidth: 3, cornerRadius: 8 }));
        s.add(_rect({ x: ax + 7, y: ay + 7, width: aw - 14, height: ah - 14, fill: '#fbfbfb', stroke: '#8d9498', strokeWidth: 1, cornerRadius: 6 }));
        s.add(_text({ x: ax + 13, y: ay + 9, width: 24, fontSize: 13, fontStyle: 'bold', fill: '#12324a', text: 'A' }));
        s.add(_text({ x: ax + aw - 40, y: ay + 11, width: 30, align: 'center', fontSize: 9, fill: '#5f6669', text: '▽R' }));
        s.add(new Konva.Arc({ x: acx, y: acy, innerRadius: aR - 9, outerRadius: aR, angle: 180, rotation: 180, fill: '#d8d8d8', listening: false }));
        s.add(new Konva.Arc({ x: acx, y: acy, innerRadius: aR - 9, outerRadius: aR, angle: 36, rotation: 324, fill: C_RED, listening: false }));
        for (let i = 0; i <= 20; i++) {
            const a = Math.PI + (i / 20) * Math.PI;
            const major = i % 5 === 0;
            const r1 = aR - 9 - (major ? 7 : 3);
            s.add(_line({
                points: [acx + Math.cos(a) * r1, acy + Math.sin(a) * r1, acx + Math.cos(a) * (aR - 10), acy + Math.sin(a) * (aR - 10)],
                stroke: '#2a2d30', strokeWidth: major ? 1.4 : 0.8,
            }));
        }
        [['0', 0], ['50', 1 / 3], ['100', 2 / 3], ['150', 1]].forEach(([txt, t]) => {
            const a = Math.PI + t * Math.PI;
            s.add(_text({
                x: acx + Math.cos(a) * (aR - 21) - 14, y: acy + Math.sin(a) * (aR - 21) - 6, width: 28, align: 'center',
                fontSize: 8.5, fill: '#2a2d30', text: txt,
            }));
        });
        const aboxW = 58, aboxX = ax + (aw - aboxW) / 2;          // 读数框水平居中
        s.add(_rect({ x: aboxX, y: ay + ah - 30, width: aboxW, height: 22, fill: '#ffffff', stroke: '#2a2d30', strokeWidth: 1.5, cornerRadius: 2 }));
        s.add(_text({ x: aboxX, y: ay + ah - 8, width: aboxW, align: 'center', fontSize: 7, fill: '#5f6669', text: '⊙-1.5|☆' }));
        s.add(_circle({ x: ax + aw - 30, y: ay + ah - 24, radius: 11, fill: '#2a2d30', stroke: '#9aa0a0', strokeWidth: 1.4 }));
        s.add(_circle({ x: ax + aw - 30, y: ay + ah - 24, radius: 3.5, fill: '#6f7679' }));

        // 4 列等间距（左右留白相同）；三排，末排中心距箱底 20 + 30 = 50 px
        // 4 列等距；首/末列外沿到箱边 37.5（原 27.5，各加 10）
        const colX = (c) => 1203.5 + c * 108.333;
        const ROW_Y = [501, 614, 727];   // 上两排各上移 5 / 10，末排上移 15
        const putLabel = (txt, x, y) => s.add(_text({
            x: x - 56, y: y - 46, width: 112, align: 'center', fontSize: 11.5, fill: '#12324a', text: txt,
        }));

        // 上两排：指示灯（文字在上）
        TG_LAMPS.forEach(([txt, color, dim, key, c, r]) => {
            const x = colX(c), y = ROW_Y[r];
            putLabel(txt, x, y);
            s.add(_circle({ x, y, radius: 30, fill: '#141618', stroke: '#000000', strokeWidth: 2 }));   // 黑色外框
            s.add(_circle({ x, y, radius: 24, fill: dim, stroke: '#2f3538', strokeWidth: 1 }));
            this._tgLamps.push({ node: null, x, y, color, dim, key });
        });

        // 第一排右端：试灯按钮（白色外框 + 深色帽）
        {
            const x = colX(3), y = ROW_Y[0];
            putLabel('试灯', x, y);
            s.add(_circle({ x, y, radius: 30, fill: '#d9dde0', stroke: '#9aa0a0', strokeWidth: 2 }));   // 仅白色外框
            s.add(_circle({ x, y, radius: 25, fill: '#3a3d40', stroke: '#1f2225', strokeWidth: 2 }));
        }

        // 末排左二：正转 / 倒转 操作按钮（白色外框 + 深绿帽）
        ['正转', '倒转'].forEach((txt, c) => {
            const x = colX(c), y = ROW_Y[2];
            putLabel(txt, x, y);
            s.add(_circle({ x, y, radius: 30, fill: '#d9dde0', stroke: '#9aa0a0', strokeWidth: 2 }));   // 仅白色外框
            s.add(_circle({ x, y, radius: 25, fill: '#0f7018', stroke: '#062a0b', strokeWidth: 2 }));   // 静态帽（不随按下变化）
        });

        // 末排右二：本地/遥控选择开关、加热断/通开关（白色外框 + 两档刻线 ±45°）
        [['本地', '遥控'], ['断', '通']].forEach(([l1, l2], i) => {
            const c = 2 + i, x = colX(c), y = ROW_Y[2];
            s.add(_text({ x: x - 68, y: y - 46, width: 66, align: 'center', fontSize: 11.5, fill: '#12324a', text: l1 }));
            s.add(_text({ x: x + 2, y: y - 46, width: 66, align: 'center', fontSize: 11.5, fill: '#12324a', text: l2 }));
            s.add(_circle({ x, y, radius: 30, fill: '#d9dde0', stroke: '#9aa0a0', strokeWidth: 2 }));
            s.add(_circle({ x, y, radius: 24, fill: '#1a1c1e', stroke: '#0a0c0d', strokeWidth: 2 }));
            s.add(_circle({ x, y, radius: 19, fill: '#2b2f33', stroke: '#7d8488', strokeWidth: 1.2 }));
            [-45, 45].forEach((deg) => {
                const a = (deg - 90) * Math.PI / 180;
                s.add(_line({
                    points: [x + Math.cos(a) * 21, y + Math.sin(a) * 21, x + Math.cos(a) * 27, y + Math.sin(a) * 27],
                    stroke: '#12324a', strokeWidth: 1.5,
                }));
            });
        });
    }

    _drawStatic() {
        const s = this._staticGroup;
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: '#eceff0' }));
        this._drawLocalBoard(s);
        this._drawMatrix(s);
        this._drawSwitches(s);
        const right = new Konva.Group({ x: RX, y: 0, listening: false });
        s.add(right);
        this._drawGauges(right);
        this._drawTurningGear(right);
    }

    /**
     * 灯测试类按钮（自复位、按住亮松手灭）：
     *  · mousedown/touchstart → 点亮（保持）；mouseup/touchend/mouseleave → 熄灭；
     *    ★ 指针在按钮外松开时也能熄灭（舞台级 mouseup 兜底）；
     *  · 程序化 fire('click')（无真实指针事件 e.evt）→ 亮 1.5 s，供自动演示使用；
     *    ★ 真实点击（e.evt 存在）不再额外延时，松手即灭。
     */
    _bindMomentaryLamp(partId, prop) {
        const hit = this.getClickablePartNode(partId);
        if (!hit) return;
        const on = (e) => {
            if (e && e.cancelBubble !== undefined) e.cancelBubble = true;
            this[prop] = true;
            this._redraw();
        };
        const off = () => {
            if (!this[prop]) return;
            this[prop] = false;
            this._redraw();
        };
        hit.on('mousedown touchstart', on);
        hit.on('mouseup touchend', off);
        hit.on('mouseleave', off);
        const stage = this.getStage ? this.getStage() : (this.sys && this.sys.stage);
        if (stage) stage.on('mouseup touchend', off);      // 指针移出按钮后在别处松开
        hit.on('click tap', (e) => {
            if (e && e.evt) return;                        // 真实点击：已由 mousedown/mouseup 处理
            this[prop] = true;
            this._redraw();
            setTimeout(() => { this[prop] = false; this._redraw(); }, 1500);
        });
    }

    // ═══════════════════════════════════════════════════════
    //  动态图形
    // ═══════════════════════════════════════════════════════

    _createDynamic() {
        const d = this._dynamicGroup;

        // 左列圆钮的指示灯
        this._btnLamp = {};
        LEFT_BTNS.map(([id, , y]) => [id, COL_LEFT, y]).forEach(([id, x, y]) => {
            const lamp = _circle({ x: x - 23, y: y - 23, radius: 7, fill: C_LAMP_OFF });
            d.add(lamp);
            this._btnLamp[id] = lamp;
        });

        // 车钟档位灯
        this._telLamp = TELEGRAPH.map((t, i) => {
            const lamp = _circle({ x: COL_TEL - 21, y: TEL_Y0 + i * TEL_STEP - 21, radius: 7, fill: C_LAMP_OFF });
            d.add(lamp);
            return lamp;
        });

        // 矩阵格子（动态层：亮灯底色 + 文字）
        MATRIX.forEach((row, r) => {
            row.forEach((cell, c) => {
                const x = MX_X0 + c * MX_PW, y = MX_Y0 + r * MX_PH, w = MX_W, h = MX_H;
                const rect = _rect({ x, y, width: w, height: h, fill: cell.dim, stroke: '#000000', strokeWidth: MX_LINE });
                d.add(rect);
                const txt = _text({ x: x + 2, y, width: w - 4, height: h, align: 'center', verticalAlign: 'middle', fontSize: 14, lineHeight: 1.12, fill: '#f0f0f0', text: cell.text });
                d.add(txt);
                this._cells[cell.key] = {
                    rect, txt, id: cell.id,
                    color: cell.color,      // 点亮色
                    dim: cell.dim,          // 不亮时的暗色
                    alarm: cell.alarm,      // 未确认时闪烁
                };
            });
        });

        // 三档转换开关手柄（左 -60 = 冲车 / 0 = 自动 / 右 +60 = 慢转起动）
        this._startKnob = new Konva.Group({ x: 698, y: 488, listening: false });
        this._startKnob.add(new Konva.Rect({
            x: -7, y: -42, width: 14, height: 84, cornerRadius: 7,
            fill: 'rgba(0,0,0,0)', stroke: '#f2f2f2', strokeWidth: 2.5, listening: false,
        }));
        this._startKnob.add(new Konva.Rect({ x: -4, y: -40, width: 8, height: 16, fill: '#f2f2f2', listening: false }));
        d.add(this._startKnob);

        // EM STOP 外盖（合上时遮住按钮，点击才能打开）
        this._emCoverOpen = false;
        this._emCover = new Konva.Group({ x: 472, y: 480, listening: false });
        // 金属盖板：不透明浅灰实心板 + 深色描边 + 内嵌框 + 四角螺钉 + 底部提手，遮盖感明显
        this._emCover.add(new Konva.Rect({
            width: 74, height: 74, cornerRadius: 6,
            fill: '#c6ccd0', stroke: '#3f464a', strokeWidth: 3, listening: false,
        }));
        this._emCover.add(new Konva.Rect({
            x: 5, y: 5, width: 64, height: 64, cornerRadius: 4,
            fill: '#b6bdc2', stroke: '#8d959a', strokeWidth: 1, listening: false,
        }));
        [[14, 14], [60, 14], [14, 60], [60, 60]].forEach(([sx, sy]) => {
            this._emCover.add(new Konva.Circle({ x: sx, y: sy, radius: 3.5, fill: '#7c848a', stroke: '#4a5155', strokeWidth: 1, listening: false }));
        });
        this._emCover.add(new Konva.Rect({ x: 23, y: 60, width: 28, height: 8, cornerRadius: 3, fill: '#565d61', stroke: '#343a3e', strokeWidth: 1, listening: false }));
        this._emCover.add(_text({ x: 0, y: 24, width: 74, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#262b2e', text: '外盖' }));
        d.add(this._emCover);

        // EM STOP 红色按钮帽（无指示灯/高光）：
        //  · 弹出 —— 帽体 r=28（大于护圈开口 25，凸起在护圈之上），上移 2 px，底部露出落影；
        //  · 按下 —— 帽体 r=27（略小于弹出 28，凹进护圈内），下沉 4 px。
        this._emCap = new Konva.Group({ x: 509, y: 517, listening: false });
        this._emCapShadow = new Konva.Circle({ x: 0, y: 3, radius: 26, fill: '#4a0810', listening: false });
        this._emCapBody = new Konva.Circle({ x: 0, y: 0, radius: 26, fill: '#d0232c', stroke: '#ef5b64', strokeWidth: 1.5, listening: false });
        this._emCap.add(this._emCapShadow);
        this._emCap.add(this._emCapBody);
        d.add(this._emCap);

        // 车钟大表盘指针
        // 指针（指示条）+ 端部小圆头：0° = 正上，端点半径 52 + 7 = 59 < 数字环内沿，不遮刻度文字
        this._telegraphNeedle = new Konva.Group({ x: DIAL_CX, y: DIAL_CY, rotation: 0, listening: false });
        this._telegraphNeedle.add(new Konva.Line({ points: [0, -14, 0, -52], stroke: '#20242a', strokeWidth: 9, lineCap: 'round', listening: false }));
        this._telegraphNeedle.add(new Konva.Line({ points: [0, -14, 0, -52], stroke: '#f2c14e', strokeWidth: 5, lineCap: 'round', listening: false }));
        this._telegraphNeedle.add(new Konva.Circle({ x: 0, y: -52, radius: 7, fill: '#f2c14e', stroke: '#20242a', strokeWidth: 2, listening: false }));
        d.add(this._telegraphNeedle);

        // 三只仪表指针 + 数值
        // 右侧整块动态节点放进偏移组（与静态层同步左移）
        const rd = new Konva.Group({ x: RX, y: 0, listening: false });
        d.add(rd);

        // 表盘指针圆心 = (x + W/2, GAUGE_Y + H - 34)；动态数值在白色数字框内水平居中
        const gy = GAUGE_Y + GAUGE_H - 64;
        const gv = (x, t) => _text({
            x: x + (GAUGE_W - 74) / 2, y: GAUGE_Y + 131, width: 74, align: 'center',
            fontSize: 13, fontStyle: 'bold', fill: '#12324a', text: t,
        });
        this._gauges.air = { needle: this._mkNeedle(1110, gy, 54, 3.5, rd), value: gv(1017, '28') };
        this._gauges.rpm = { needle: this._mkNeedle(1300, gy, 54, 3.5, rd), value: gv(1207, '68.0') };
        this._gauges.hyd = { needle: this._mkNeedle(1490, gy, 54, 3.5, rd), value: gv(1397, '280') };
        rd.add(this._gauges.air.value, this._gauges.rpm.value, this._gauges.hyd.value);

        // 盘车机指示灯（动态）
        this._tgLamps.forEach((l) => {
            const node = _circle({ x: l.x, y: l.y, radius: 24, fill: l.dim || '#1a1c1e' });
            rd.add(node);
            l.node = node;
        });

        // 控制箱：电源开关旋钮指针（ON 指左上 / OFF 指左下）
        this._tgPowerOn = true;
        // 电流表动态读数（居中于读数框，字号 14）
        this._gauges.amp = {
            needle: this._mkNeedle(1464.5, 367, 40, 2.5, rd),
            value: _text({ x: 1435.5, y: 287 + 118 - 27, width: 58, align: 'center', fontSize: 14, fontStyle: 'bold', fill: '#12324a', text: '0' }),
        };
        rd.add(this._gauges.amp.value);

        // 遥控盒电源按钮芯（随电源通断）
        this._tgRemotePower = _circle({ x: 1066, y: 345, radius: 24, fill: '#f2f2f2', stroke: '#7a5f10', strokeWidth: 1 });
        rd.add(this._tgRemotePower);

        // 遥控盒 正转 / 倒转 带灯按钮的灯芯
        this._tgRemoteJog = [
            _circle({ x: 1066, y: 501, radius: 25, fill: '#111111', stroke: '#7a5f10', strokeWidth: 1 }),
            _circle({ x: 1066, y: 614, radius: 25, fill: '#111111', stroke: '#7a5f10', strokeWidth: 1 }),
        ];
        this._tgRemoteJog.forEach((n) => rd.add(n));

        this._tgPowerPtr = new Konva.Group({ x: 1251, y: 339, rotation: 0, listening: false });
        this._tgPowerPtr.add(new Konva.Line({ points: [0, 0, -24, -22], stroke: '#e9eef0', strokeWidth: 9, lineCap: 'round', listening: false }));
        rd.add(this._tgPowerPtr);

        // 矩阵第 3 行：本地/遥控选择开关、加热器通断开关（白色指示条 -> 左/右）
        this._tgSelLocal = (String(this.model && this.model.turningGearMode || 'REMOTE') === 'LOCAL');
        this._tgHeaterOn = true;
        this._tgSwitchPtr = [1420.2, 1528.5].map((x) => {
            const g = new Konva.Group({ x, y: 727, rotation: 0, listening: false });
            g.add(new Konva.Line({ points: [0, 0, 0, -16], stroke: '#e9eef0', strokeWidth: 6, lineCap: 'round', listening: false }));
            rd.add(g);
            return g;
        });
    }

    _mkNeedle(cx, cy, R, w, parent) {
        const g = new Konva.Group({ x: cx, y: cy, rotation: 180, listening: false });
        g.add(new Konva.Line({ points: [0, 0, R, 0], stroke: '#20242a', strokeWidth: w + 1.5, lineCap: 'round', listening: false }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#20242a', listening: false }));
        (parent || this._dynamicGroup).add(g);
        return g;
    }

    // ═══════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const M = this.model;
        const mk = (id, x, y, w, h, onClick) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (onClick) hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); this._redraw(); });
            return hit;
        };

        // 左列圆钮
        const tap = {
            // 副车钟（工况）由驾驶台/集控室两步回令切换，机旁只显示、不参与
            'mode-atsea': null,
            'mode-standby': null,
            'mode-fwe': null,
            'pos-bridge': () => this._setPos(CONTROL_POS.BRIDGE),
            'pos-ecr': () => this._setPos(CONTROL_POS.ECR),
            'pos-local': () => this._setPos(CONTROL_POS.LOCAL),
            'wrong-way': () => { },
            'lamp-test': null,
            'spare-1': () => { },
        };
        LEFT_BTNS.forEach(([id, , y]) => mk(id, COL_LEFT - 33, y - 33, 66, 66, tap[id]));

        // 左列 Lamp Test 圆钮：按住（mousedown）保持灯亮，松手（mouseup）灯灭
        this._bindMomentaryLamp('lamp-test', '_ltBoard');

        // 中部「试灯」按钮：只控制右侧 16 个指示灯（操纵板 20 个灯不受影响）
        this.addClickablePart('test-lamp', 472, 400, 74, 74);
        this._bindMomentaryLamp('test-lamp', '_ltPanel');

        // 车钟档位
        TELEGRAPH.forEach((t, i) => {
            mk(`tel-${i}`, COL_TEL - 29, TEL_Y0 + i * TEL_STEP - 29, 58, 58, () => {
                // 任何时候都能按：只对机旁车令（不动调速手柄）；控制权在机旁时才改变主机给定
                M.setLeverById(t.id, CONTROL_POS.LOCAL, true);
                this._tip(M.controlPos === CONTROL_POS.LOCAL
                    ? `机旁车令对到：${t.label}`
                    : `机旁车令预置：${t.label}（控制权不在机旁，仅作请求）`);
            });
        });

        // 矩阵格：可操作的按语义绑定
        const cellAt = (id) => {
            let out = null;
            MATRIX.forEach((row, r, ) => row.forEach((c, ci) => { if (c.id === id) out = { x: MX_X0 + ci * MX_PW, y: MX_Y0 + r * MX_PH }; }));
            return out;
        };
        const mkCell = (id, onClick) => {
            const p = cellAt(id);
            if (p) mk(id, p.x, p.y, MX_PW, MX_PH, onClick);
        };
        mkCell('mx-local', () => this._setPos(CONTROL_POS.LOCAL));
        // 带灯按钮：降速取消 = Cancel SLD；停车取消 = Cancel SHD；负荷限制增高 = Cancel Limits
        mkCell('mx-sld-cancel', () => {
            const on = !M.cancelSLD;
            if (on) {
                M.setManualSlowDown(false);            // 点降速取消：手动降速请求灯熄灭
                this._sldActHeld = false;              // 降速激活不会自动触发，需再次请求
            }
            M.setCancel('SLD', on, CONTROL_POS.LOCAL);
            M.setCancelAlarm('sld', M.cancelSLD);
            this._tip(on ? '降速取消（Cancel SLD）：越控自动减速' : '取消越控：恢复自动减速');
        });
        mkCell('mx-sd-cancel', () => {
            const on = !M.cancelSHD;
            M.setCancel('SHD', on, CONTROL_POS.LOCAL);
            M.setCancelAlarm('shd', M.cancelSHD);
            this._tip(on ? '停车取消（Cancel SHD）：越控自动停车' : '取消越控：恢复自动停车');
        });
        mkCell('mx-ecr', () => this._setPos(CONTROL_POS.ECR));
        mkCell('mx-bridge', () => this._setPos(CONTROL_POS.BRIDGE));
        mkCell('mx-force', () => { M.forceTakeControl(); this._tip('控制权强制获取：机旁接管'); });
        // 手动降速请求：与自动减速同一套动作（置 slowDown、减速到 40 rpm、报警栏两行）
        mkCell('mx-sld-req', () => {
            M.setManualSlowDown(!M.slowDownReq);
            this._sldActHeld = true;                   // 再次触发后「降速激活」才亮
            this._tip(M.slowDownReq ? '手动降速请求' : '手动降速请求已撤销');
        });
        mkCell('mx-sld-act', () => this._tip('降速激活（自动减速动作中）'));
        mkCell('mx-sld-reset', () => {
            M.setManualSlowDown(false);
            M.slowDown = false;                        // 复位：解除减速锁存
            M.sldAwaitReset = false;
            this._tip('降速复位');
        });
        mkCell('mx-sd-act', () => this._tip('停车激活（自动停车动作中）'));

        mkCell('mx-blower-run', () => this._tip('辅助鼓风机运行中'));
        mkCell('mx-blower-alarm', () => this._tip('辅助鼓风机报警'));
        mkCell('mx-turn-out', null);          // 纯指示灯：盘车机脱开/合上在气动操纵系统里操作
        mkCell('mx-air-dist', () => this._tip('空气分配器在工作位'));
        mkCell('mx-main-valve', () => this._tip('主起动阀在工作位'));
        mkCell('mx-not-ready', () => this._tip('主机备车未完成'));
        mkCell('mx-lim-act', null);            // 纯指示灯：只显示负荷限制是否激活，按下无效
        mkCell('mx-lim-up', () => {
            const on = !M.cancelLimits;
            M.setCancel('LIM', on, CONTROL_POS.LOCAL);
            M.setCancelAlarm('lim', M.cancelLimits);
            this._tip(on ? '负荷限制增高（Cancel Limits）：取消各项限制' : '恢复限制');
        });
        mkCell('mx-start-block', () => this._tip('起动阻塞：盘车机/空气分配器/主起动阀不在位'));
        mkCell('mx-start-fail', () => this._tip('起动失败'));

        // EM STOP：合上外盖时不可操作，先点外盖打开
        mk('em-stop', 472, 480, 74, 74, () => {
            if (!this._emCoverOpen) { this._tip('请先打开 EM STOP 外盖'); return; }
            M.emStopCoverOpen = true;                  // 与组件外盖同步，交给模型的自锁逻辑
            const latched = M.pressEmStop('LOCAL');    // 按一次 → 机旁紧急停车并保持（记录 LOCAL 开关动作）
            this._tip(latched ? '机旁紧急停车：燃油切断，主机停车（按钮自锁）' : '按钮已弹出：报警保持，控制权面板车钟拉回 STOP 才复位');
        });
        const emCoverHit = this.addClickablePart('em-stop-cover', 472, 480, 74, 74);
        const placeCover = () => {
            // 合上：盖板盖住按钮；打开：**立在按钮左边缘旁边**（侧视薄板 472…490），再点一次盖回
            const open = this._emCoverOpen;
            const hitGroup = emCoverHit.getParent();
            const bgRect = hitGroup && hitGroup.getChildren()[0];
            if (hitGroup) { hitGroup.x(472); hitGroup.y(480); }
            const hw = open ? 18 : 74;
            emCoverHit.width(hw);
            if (bgRect) bgRect.width(hw);
            if (this._parts && this._parts['em-stop-cover']) {
                this._parts['em-stop-cover'].x = 472;
                this._parts['em-stop-cover'].y = 480;
                this._parts['em-stop-cover'].w = hw;
                this._parts['em-stop-cover'].h = 74;
            }
            if (this._emCover) {
                this._emCover.x(472);
                this._emCover.y(480);
                this._emCover.rotation(0);
                this._emCover.scaleX(open ? 0.18 : 1);     // 立起来的盖板：侧视为窄条
                this._emCover.visible(true);
                const t = this._emCover.find('Text')[0];
                if (t) t.visible(!open);                    // 背面无文字
            }
        };
        emCoverHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this._emCoverOpen = !this._emCoverOpen;
            placeCover();
            this._tip(this._emCoverOpen ? 'EM STOP 外盖已打开' : 'EM STOP 外盖已合上');
            this._redraw();
        });
        this._placeEmCover = placeCover;

        // 三档转换开关：冲车（左）/ 自动（中）/ 慢转起动（右）—— 点左右半区换档，端点不循环
        this._startSel = String(M.startKnob || 'AUTO');
        const startHit = this.addClickablePart('start-knob', 633, 423, 130, 130);
        startHit.on('click tap', (e) => {
            e.cancelBubble = true;
            const stage = this.sys && this.sys.stage;
            const ptr = stage && stage.getPointerPosition ? stage.getPointerPosition() : null;
            let dir = 1;
            if (ptr) {
                const lo = this.group.getAbsoluteTransform().copy().invert().point(ptr);
                dir = lo.x >= 698 ? 1 : -1;                 // 右半 → 顺时针；左半 → 逆时针
            }
            const order = ['BLOW', 'AUTO', 'SLOW'];
            const i = order.indexOf(this._startSel);
            const n = Math.max(0, Math.min(order.length - 1, i + (dir > 0 ? 1 : -1)));
            if (n === i) return;
            const sel = order[n];
            M.setStartKnob(sel, 'LOCAL');
            this._startSel = sel;
            const off = (M.controlPos !== 'LOCAL') ? '（控制权不在机旁，不输出）' : '';
            if (sel === 'BLOW') this._tip(`冲车：起动电磁阀A得电，主机加速到 20 rpm 并保持${off}`);
            else if (sel === 'SLOW') this._tip(`慢转：慢转电磁阀得电，主机以很低转速正转${off}`);
            else this._tip(`自动：撤除冲车 / 慢转${off}`);
            this._redraw();
        });

        // 车钟刻度大表盘：控制权在机旁时，直接给定主机转速
        const dialHit = this.addClickablePart('local-dial', DIAL_CX - 108, DIAL_CY - 108, 216, 216);
        this._applyDial = () => {
            const stage = this.sys && this.sys.stage;
            const ptr = stage && stage.getPointerPosition ? stage.getPointerPosition() : null;
            if (!ptr) return;
            const lo = this.group.getAbsoluteTransform().copy().invert().point(ptr);
            const dx = lo.x - DIAL_CX, dy = lo.y - DIAL_CY;
            let deg = Math.atan2(dx, -dy) * 180 / Math.PI;      // 0 = 正上（STOP）
            deg = Math.max(-DIAL_MAX, Math.min(DIAL_MAX, deg)); // −135°…+135°
            const rpm = deg >= 0 ? (deg / DIAL_MAX) * 68 : (deg / DIAL_MAX) * 55;  // 右 AHEAD / 左 ASTERN
            // 调速手柄只给转速（localSpeed），**不动车钟**；控制权在机旁时才改写主机给定
            M.setLocalSpeed(rpm);
            this._redraw();
        };
        // 按住旋钮拖动：mousedown 起拖，舞台级 mousemove 连续跟随，mouseup 松开
        this._dialDrag = false;
        dialHit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            // 只有按在**手柄（旋钮）上**才开始拖动；点刻度盘其它位置无效
            const st0 = this.sys && this.sys.stage;
            const p0 = st0 && st0.getPointerPosition ? st0.getPointerPosition() : null;
            if (p0) {
                const l0 = this.group.getAbsoluteTransform().copy().invert().point(p0);
                if (Math.hypot(l0.x - DIAL_CX, l0.y - DIAL_CY) > 64) return;   // 手柄整体（旋钮+指示条+端头外沿 59）都可按下起拖
            }
            this._dialDrag = true;
            if (this.group.draggable) this.group.draggable(false);   // 拖旋钮时不要拖动整块面板
            this._applyDial();
        });
        const stage = this.sys && this.sys.stage;
        if (stage) {
            stage.on('mousemove touchmove', () => { if (this._dialDrag) { this._applyDial(); } });
            stage.on('mouseup touchend', () => {
                if (!this._dialDrag) return;
                this._dialDrag = false;
                if (this.group.draggable) this.group.draggable(true);
            });
        }
        // 单击不改变转速：只能按住手柄拖动

        // 遥控盒
        // 遥控盒「电源」：常亮指示（不动作，也不影响盘车机脱开/合上）
        mk('tg-power', 1036 + RX, 315, 60, 60, null);
        // 遥控盒 正转 / 倒转：带灯按钮，按住点动、松手熄灭
        const jogRemote = (id, dir, name, y) => {
            const hit = this.addClickablePart(id, 1036 + RX, y, 60, 60);
            hit.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (!M.turningGearPower) { this._tip('盘车机电源未接通'); return; }
                if (M.turningGearMode !== 'REMOTE') { this._tip('控制方式为「本地」：遥控盒按钮不起作用'); return; }
                M.setTurningGearJog(dir, 'REMOTE');
                this._tip(`遥控盒：盘车机${name}（点动，松手停止）`);
                this._redraw();
            });
            const stop = () => { if (M.turningGearJog) { M.setTurningGearJog(0); this._redraw(); } };
            hit.on('mouseup touchend mouseleave', stop);
            const stg = this.sys && this.sys.stage;
            if (stg) stg.on('mouseup touchend', stop);
            hit.on('click tap', (e) => {
                if (e && e.evt) return;
                if (!M.turningGearPower) return;
                if (M.turningGearMode !== 'REMOTE') { this._tip('控制方式为「本地」：遥控盒按钮不起作用'); return; }
                M.setTurningGearJog(dir, 'REMOTE');
                setTimeout(() => { M.setTurningGearJog(0); this._redraw(); }, 1000);
            });
        };
        jogRemote('tg-fwd', 1, '正转', 471);
        jogRemote('tg-rev', -1, '倒转', 584);
        // 控制箱电源开关旋钮：ON ⇄ OFF（只控制电源）
        mk('tg-power-knob', 1209 + RX, 301, 88, 92, () => {
            const on = M.toggleTurningGearPower();
            this._tgPowerOn = on;
            this._tip(on ? '盘车机控制箱电源：ON' : '盘车机控制箱电源：OFF');
        });

        // 正转 / 倒转 点动按钮：按下并保持才接通电机，松手立即停机
        this._bindJog = (id, dir, name, x, y, w) => {
            const hit = this.addClickablePart(id, x, y, w || 60, w || 60);
            hit.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (!M.turningGearPower) { this._tip('盘车机控制箱电源未接通'); return; }
                if (M.turningGearMode !== 'LOCAL') { this._tip('控制方式为「遥控」：控制箱按钮不起作用'); return; }
                M.setTurningGearJog(dir, 'LOCAL');
                this._tip(`盘车机${name}（点动，松手停止）`);
                this._redraw();
            });
            const stop = () => { if (M.turningGearJog) { M.setTurningGearJog(0); this._redraw(); } };
            hit.on('mouseup touchend mouseleave', stop);
            const stage0 = this.sys && this.sys.stage;
            if (stage0) stage0.on('mouseup touchend', stop);
            hit.on('click tap', (e) => {       // 程序化点击：点动 1 s
                if (e && e.evt) return;
                if (!M.turningGearPower) return;
                if (M.turningGearMode !== 'LOCAL') { this._tip('控制方式为「遥控」：控制箱按钮不起作用'); return; }
                M.setTurningGearJog(dir, 'LOCAL');
                setTimeout(() => { M.setTurningGearJog(0); this._redraw(); }, 1000);
            });
        };
        // 试灯按钮（按住 → 控制箱所有指示灯点亮，松手还原）；必须先注册热区再绑定
        this.addClickablePart('tg-lamp-test', 1498 + RX, 471, 60, 60);
        this._bindMomentaryLamp('tg-lamp-test', '_tgLampTest');
        // 控制箱末排：正转 / 倒转（点动，指示由上一排指示灯显示）
        this._bindJog('tg-jog-fwd', 1, '正转', 1173 + RX, 697);
        this._bindJog('tg-jog-rev', -1, '倒转', 1281 + RX, 697);

        // 本地 / 遥控选择开关
        mk('tg-sel', 1390 + RX, 697, 60, 60, () => {
            if (!M.turningGearPower) { this._tip('盘车机控制箱电源未接通'); return; }
            const mode = M.toggleTurningGearMode();
            this._tgSelLocal = mode === 'LOCAL';
            this._tip(mode === 'LOCAL' ? '盘车机控制：本地（由机旁控制箱操作）' : '盘车机控制：遥控（由遥控盒操作）');
        });
        // 加热器通断开关
        mk('tg-heat', 1498 + RX, 697, 60, 60, () => {
            if (!M.turningGearPower) { this._tip('盘车机控制箱电源未接通'); return; }
            this._tgHeaterOn = !this._tgHeaterOn;
            this._tip(this._tgHeaterOn ? '加热器：通' : '加热器：断');
        });
        mk('tg-estop', 1036 + RX, 697, 60, 60, () => {
            M.turningGearEmergencyStop();
            this._tip('盘车机应急停止（只停盘车机，不影响主机）');
        });

        // 控制箱
    }

    _setPos(pos) {
        const M = this.model;
        const name = { BRIDGE: '驾驶台', ECR: '集控室', LOCAL: '机旁' }[pos];
        const cur = { BRIDGE: '驾驶台', ECR: '集控室', LOCAL: '机旁' }[M.controlPos] || M.controlPos;
        const r = M.pressPosButton(this.posKey, pos);
        if (r === 'give') this._tip(`请求把控制位置交给${name}（车钟一致后在${name}按同位置键确认）`);
        else if (r === 'take') this._tip(`请求从${cur}接管控制位置（车钟一致后由${cur}按同位置键确认交出）`);
        else if (r === 'ok') this._tip(`控制位置已转到${name}`);
        else if (r === 'mismatch') this._tip(`车钟不一致：先把${name}与${cur}的车钟拉一致再确认`);
        else if (r === 'cancel') this._tip('已取消控制位置转移');
        else if (r === 'blocked') this._tip(`控制权在${cur}：只能由${cur}按键交出控制权，本位置不能直接接管`);
        else this._tip(`当前控制位置：${cur}`);
    }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════

    _angleFor(v, lo, hi) {
        const pct = Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)));
        return 180 + pct * 180;
    }

    tick() {
        const M = this.model;
        if (!M) return;

        // 左列圆钮指示灯（不亮 = 白；试灯按住时按各自颜色全部点亮）
        // 配色：Stand By / ECR / Stop = 黄；FWE / Local / Wrong Way / Lamp Test / 倒车档 = 红；其余 = 绿
        const lampOn = (on, color) => ((on || this._ltBoard) ? color : C_LAMP_OFF);
        // 工况灯：已生效常亮；驾驶台/集控室请求待回令时该工况灯闪烁
        const modeOn = (m) => M.engineMode === m;
        const modeReq = (m) => !!(M.modeReq && M.modeReq.to === m) && !!(M.blink !== undefined ? M.blink : true);
        this._btnLamp['mode-atsea'].fill(lampOn(modeOn('SEA') || modeReq('SEA'), C_LAMP_G));
        this._btnLamp['mode-standby'].fill(lampOn(modeOn('STANDBY') || modeReq('STANDBY'), C_LAMP_A));
        this._btnLamp['mode-fwe'].fill(lampOn(modeOn('FWE') || modeReq('FWE'), C_LAMP_R));
        // 控制权转移进行中：目标位置的指示灯闪烁（如 ECR → 机旁时 Local 灯闪烁）
        const flashing = (pos) => !!(M.transferReq && M.transferReq.to === pos) && M.blink;
        this._btnLamp['pos-bridge'].fill(lampOn(M.controlPos === CONTROL_POS.BRIDGE || flashing(CONTROL_POS.BRIDGE), C_LAMP_G));
        this._btnLamp['pos-ecr'].fill(lampOn(M.controlPos === CONTROL_POS.ECR || flashing(CONTROL_POS.ECR), C_LAMP_A));
        this._btnLamp['pos-local'].fill(lampOn(M.controlPos === CONTROL_POS.LOCAL || flashing(CONTROL_POS.LOCAL), C_LAMP_R));
        this._btnLamp['wrong-way'].fill(lampOn(M.wrongWay, C_LAMP_R));
        this._btnLamp['lamp-test'].fill(lampOn(this._ltBoard, C_LAMP_W));
        if (this._btnLamp['spare-1']) this._btnLamp['spare-1'].fill(lampOn(false, C_LAMP_G));

        // 车钟档位灯（只用于对车令，不影响速度设定）：
        //  · 机旁车令所在档 —— 常亮；
        //  · 与驾驶台车令不一致时，驾驶台对应的档位 —— 闪烁；
        //  · 两者一致时只有该档常亮。
        // 0~4 正车档 = 绿，5 = Stop 黄，6~10 倒车档 = 红
        const telColor = (i) => (i === 5 ? C_LAMP_A : (i > 5 ? C_LAMP_R : C_LAMP_G));
        const iLocDetent = Math.round(M.leverPosAt ? M.leverPosAt(CONTROL_POS.LOCAL) : 0);
        const iBrgDetent = Math.round(M.leverPosAt ? M.leverPosAt(CONTROL_POS.BRIDGE) : 0);
        const sameOrder = (iLocDetent === iBrgDetent);
        this._telLamp.forEach((n, i) => {
            if (this._ltBoard) { n.fill(telColor(i)); return; }        // 试灯：全亮
            if (i === iLocDetent) { n.fill(telColor(i)); return; }     // 机旁选择的档：常亮
            if (!sameOrder && i === iBrgDetent) {                      // 驾驶台档：车令不一致时闪烁
                n.fill(M.blink ? telColor(i) : C_LAMP_OFF);
                return;
            }
            n.fill(C_LAMP_OFF);
        });

        // 矩阵状态
        const S = {
            local: M.controlPos === CONTROL_POS.LOCAL,
            ecr: M.controlPos === CONTROL_POS.ECR,
            bridge: M.controlPos === CONTROL_POS.BRIDGE,
            force: M.forceTake,
            sldReq: M.slowDownReq,
            sldAct: !!M.slowDown && !M.cancelSLD && this._sldActHeld !== false,
            sldCancel: M.cancelSLD,
            sldReset: false,
            sdAct: (M.shutDown && !M.cancelSHD) || !!M.emStopped,
            sdCancel: M.cancelSHD,
            blowerRun: M.auxBlower,
            blowerAlarm: M.auxBlowerAlarm,
            turnOut: M.turningGearOut,
            airDist: M.airDistributorOk,
            mainValve: M.mainStartValveOk,
            notReady: !M.engineReady,
            limAct: M.loadLimit && !M.cancelLimits,
            limUp: M.cancelLimits,
            startBlock: M.startBlocked,
            startFail: M.startFail,
        };
        const blinkOn = M.blink;
        Object.entries(this._cells).forEach(([key, cell]) => {
            const on = !!S[key];
            // 报警类（红）未确认时闪烁；状态类常亮
            const isAlarm = !!cell.alarm;
            const lt = this._ltPanel;                          // 试灯：矩阵 20 个带灯按钮（含 4 个操作按钮）全部点亮
            const lit = lt ? true : (isAlarm ? (on && (M.acked || blinkOn)) : on);
            cell.rect.fill(lit ? cell.color : cell.dim);
            cell.txt.fill(lit
                ? (DARK_TEXT.has(cell.color) ? '#101010' : '#ffffff')
                : (DIM_DARK_TEXT.has(cell.dim) ? '#2f3538' : '#9aa3a6'));
        });

        // EM STOP 外盖：合上时遮住按钮
        if (this._placeEmCover) this._placeEmCover();
        if (this._emCap) {
            const pressed = !!M.emStopLatched;
            this._emCapShadow.visible(!pressed);                // 凸起时底部露落影
            this._emCapBody.radius(pressed ? 27 : 28);
            this._emCapBody.y(pressed ? 4 : -2);                // 凹陷下沉 / 凸起上浮
            this._emCapBody.fill(pressed ? '#8e1119' : '#d0232c');
            this._emCapBody.stroke(pressed ? '#5c0a10' : '#ef5b64');
        }

        // 三档转换开关：冲车(-60) / 自动(0) / 慢转起动(+60)
        const sel = String(M.startKnob || 'AUTO');
        this._startSel = sel;
        this._startKnob.rotation(sel === 'BLOW' ? -60 : (sel === 'SLOW' ? 60 : 0));

        // 车钟大表盘指针 = 本机旁手柄的实际位置（手柄物理位置，与是否拥有控制权无关）
        const dialRpm = (M.localSpeed !== undefined) ? M.localSpeed : 0;
        const dialDeg = dialRpm >= 0 ? (dialRpm / 68) * DIAL_MAX : (dialRpm / 55) * DIAL_MAX;
        this._telegraphNeedle.rotation(Math.max(-DIAL_MAX, Math.min(DIAL_MAX, dialDeg)));

        // 三只仪表
        this._gauges.air.needle.rotation(this._angleFor(M.startAir, 0, 40));
        this._gauges.air.value.text(String(Math.round(M.startAir)));
        this._gauges.rpm.needle.rotation(this._angleFor(M.rpm, -120, 120));
        this._gauges.rpm.value.text(M.rpm.toFixed(1));
        this._gauges.hyd.needle.rotation(this._angleFor(M.hydOil, 0, 400));
        this._gauges.hyd.value.text(String(Math.round(M.hydOil)));
        // 盘车机电流表：不转 0；脱开空转很小；合上带主机很大
        const tgA = (typeof M.turningGearCurrent === 'number') ? M.turningGearCurrent : 0;
        this._gauges.amp.needle.rotation(this._angleFor(tgA, 0, 150));
        this._gauges.amp.value.text(String(Math.round(tgA)));

        // 盘车机指示灯
        const tgOn = {
            overload: false,
            power: true,                                  // 电源常亮
            // 空间加热：加热开关在"通" 且 盘车机未运行（正/反转点动中自动停止加热）
            heater: !!this._tgHeaterOn && !(M.turningGearJog || 0),
            fwd: (M.turningGearJog || 0) > 0,      // 点动正转 → 上排「正转」指示灯亮
            rev: (M.turningGearJog || 0) < 0,      // 点动倒转 → 上排「倒转」指示灯亮
            remote: M.turningGearMode !== 'LOCAL', local: M.turningGearMode === 'LOCAL',
        };
        const pwr = !!M.turningGearPower;
        this._tgLamps.forEach((l) => {
            const on = pwr && (this._tgLampTest ? true : !!tgOn[l.key]);
            l.node.fill(on ? l.color : (l.dim || '#1a1c1e'));
        });
        if (this._tgRemotePower) this._tgRemotePower.fill(pwr ? '#f2f2f2' : '#4a4f53');
        if (this._tgRemoteJog) {
            const jog = M.turningGearJog || 0;
            this._tgRemoteJog[0].fill(pwr && jog > 0 ? '#3cff66' : '#111111');
            this._tgRemoteJog[1].fill(pwr && jog < 0 ? '#3cff66' : '#111111');
        }

        // 旋钮 / 开关指针
        if (this._tgPowerPtr) this._tgPowerPtr.rotation(this._tgPowerOn ? 0 : -90);   // ON 偏左 45° / OFF 偏左 135°
        if (this._tgSwitchPtr) {
            this._tgSwitchPtr[0].rotation((M.turningGearMode === 'LOCAL') ? -45 : 45);   // 本地：左 45°；遥控：右 45°
            this._tgSwitchPtr[1].rotation(this._tgHeaterOn ? 45 : -45);   // 通：右 45°；断：左 45°
        }

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
