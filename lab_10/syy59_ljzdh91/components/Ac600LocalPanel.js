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
 *    tg-power tg-fwd tg-rev tg-estop  ts-power ts-mode-local ts-mode-remote ts-heat
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1600, H = 800;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Arial, Microsoft YaHei' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_PANEL = '#1b1d1f';
const C_FRAME = '#3a3d40';
const C_LABEL = '#c9ccce';
const C_GREEN = '#00b23a';
const C_GREEN_D = '#0b3a16';
const C_RED = '#c40000';
const C_RED_D = '#3a0b0b';
const C_AMBER = '#c8a800';
const C_BLUE_BOX = '#bcd6d8';

/** 矩阵：4 列 × 5 行（每格文字 / 亮灯颜色 / 状态键） */
const MATRIX = [
    [
        { id: 'mx-local', text: '本地\n控制', color: C_GREEN, key: 'local' },
        { id: 'mx-ecr', text: '集控室\n控制', color: C_GREEN, key: 'ecr' },
        { id: 'mx-bridge', text: '驾驶台\n控制', color: C_GREEN, key: 'bridge' },
        { id: 'mx-force', text: '控制权\n强制获取', color: C_RED, key: 'force' },
    ],
    [
        { id: 'mx-sld-req', text: '手动\n降速\n请求', color: C_RED, key: 'sldReq' },
        { id: 'mx-sld-act', text: '降速\n激活', color: C_RED, key: 'sldAct' },
        { id: 'mx-sld-cancel', text: '降速\n取消', color: C_RED, key: 'sldCancel' },
        { id: 'mx-sld-reset', text: '降速\n复位', color: C_RED, key: 'sldReset' },
    ],
    [
        { id: 'mx-sd-act', text: '停车\n激活', color: C_RED, key: 'sdAct' },
        { id: 'mx-sd-cancel', text: '停车\n取消', color: C_RED, key: 'sdCancel' },
        { id: 'mx-blower-run', text: '辅助鼓风机\n运行', color: C_GREEN, key: 'blowerRun' },
        { id: 'mx-blower-alarm', text: '辅助鼓风机\n报警', color: C_RED, key: 'blowerAlarm' },
    ],
    [
        { id: 'mx-turn-out', text: '盘车机\n脱开', color: C_GREEN, key: 'turnOut' },
        { id: 'mx-air-dist', text: '空气分配器\n在工作位', color: C_GREEN, key: 'airDist' },
        { id: 'mx-main-valve', text: '主起动阀\n在工作位', color: C_GREEN, key: 'mainValve' },
        { id: 'mx-not-ready', text: '主机备车\n未完成', color: C_RED, key: 'notReady' },
    ],
    [
        { id: 'mx-lim-act', text: '负荷限制\n激活', color: C_RED, key: 'limAct' },
        { id: 'mx-lim-up', text: '负荷限制\n增高', color: C_RED, key: 'limUp' },
        { id: 'mx-start-block', text: '起动\n阻塞', color: C_RED, key: 'startBlock' },
        { id: 'mx-start-fail', text: '起动\n失败', color: C_RED, key: 'startFail' },
    ],
];

/** 盘车机控制箱指示灯（4 列 × 3 行） */
const TG_LAMPS = [
    ['过载', C_RED, 'overload'], ['电源', C_GREEN, 'power'], ['空间加热', '#1a3fd0', 'heater'], ['备用', C_GREEN, 'spare'],
    ['正转', C_GREEN, 'fwd'], ['倒转', C_GREEN, 'rev'], ['遥控', '#e08a00', 'remote'], ['本地控制', '#e6d000', 'local'],
    ['正转', C_GREEN, 'fwd2'], ['倒转', C_GREEN, 'rev2'], ['本地', C_GREEN, 'local2'], ['遥控', C_GREEN, 'remote2'],
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

        this._cells = {};        // 矩阵格子：id → { rect, text, color }
        this._tgLamps = [];      // 盘车机指示灯
        this._gauges = {};

        this._initGroups();
        this._init();

        this.config = { id: this.id };
    }

    _tip(msg, ms) {
        if (this.sys && this.sys._suppressComponentTips) return;
        if (this.sys && this.sys.showFloatingTip) this.sys.showFloatingTip(msg, ms || 2200);
    }

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
        s.add(_rect({ x: 6, y: 8, width: 420, height: 784, fill: C_PANEL, stroke: '#0b0c0d', strokeWidth: 2, cornerRadius: 16 }));

        // 左列：工况 / 位置 / 其他
        const leftCol = [
            ['mode-atsea', 'At Sea', 62, 'sea'],
            ['mode-standby', 'Stand By', 130, 'standby'],
            ['mode-fwe', 'FWE', 198, 'fwe'],
            ['pos-bridge', 'Bridge', 300, 'bridge'],
            ['pos-ecr', 'ECR', 368, 'ecr'],
            ['pos-local', 'Local', 436, 'local'],
            ['wrong-way', 'Wrong Way', 540, 'wrong'],
            ['lamp-test', 'Lamp Test', 610, 'lamp'],
        ];
        leftCol.forEach(([id, label, y]) => {
            s.add(_circle({ x: 92, y, radius: 34, fill: '#2a2d30', stroke: '#6b7276', strokeWidth: 2 }));
            s.add(_circle({ x: 92, y, radius: 28, fill: '#1f2225', stroke: '#4d5357', strokeWidth: 1 }));
            const fs = label.length > 7 ? 12.5 : 14;
            s.add(_text({
                x: 92 - 34, y: y - (label.includes(' ') ? 16 : 9), width: 68, align: 'center',
                fontSize: fs, lineHeight: 1.15, fill: '#e8ebec', text: label.includes(' ') ? label.replace(' ', '\n') : label,
            }));
            void id;
        });

        // 右列：车钟档位
        TELEGRAPH.forEach((t, i) => {
            const y = 46 + i * 66;
            s.add(_circle({ x: 300, y, radius: 29, fill: '#2a2d30', stroke: '#6b7276', strokeWidth: 2 }));
            s.add(_circle({ x: 300, y, radius: 23, fill: '#1f2225', stroke: '#4d5357', strokeWidth: 1 }));
            const label = t.label.replace('. ', '.\n').replace('Emp. Astern', 'Emp.\nAstern');
            s.add(_text({
                x: 300 - 29, y: y - (label.includes('\n') ? 16 : 9), width: 58, align: 'center',
                fontSize: 12, lineHeight: 1.12, fill: '#e8ebec', text: label,
            }));
        });
    }

    /** 中部：状态矩阵 4×5 */
    _drawMatrix(s) {
        const x0 = 442, y0 = 12, cw = 128, ch = 62;
        s.add(_rect({ x: x0 - 4, y: y0 - 4, width: cw * 4 + 8, height: ch * 5 + 8, fill: '#2a2d30', stroke: '#0f1112', strokeWidth: 2 }));
        MATRIX.forEach((row, r) => {
            row.forEach((cell, c) => {
                const x = x0 + c * cw, y = y0 + r * ch;
                s.add(_rect({ x: x + 2, y: y + 2, width: cw - 4, height: ch - 4, fill: '#5a2222', stroke: '#1a1c1e', strokeWidth: 1 }));
                s.add(_text({
                    x: x + 4, y: y + 8, width: cw - 8, align: 'center', fontSize: 13, lineHeight: 1.2,
                    fill: '#101010', text: cell.text,
                }));
            });
        });
    }

    /** 中部：试灯 / EM STOP / 冲车-慢转起动旋钮 */
    _drawSwitches(s) {
        // 试灯
        s.add(_rect({ x: 446, y: 344, width: 96, height: 74, fill: '#c9ccce', stroke: '#6f7679', strokeWidth: 2 }));
        s.add(_text({ x: 446, y: 374, width: 96, align: 'center', fontSize: 14, fill: '#111111', text: '试灯' }));
        // EM STOP（红色蘑菇头）
        s.add(_rect({ x: 446, y: 434, width: 96, height: 96, fill: '#3c3f42', stroke: '#1f2225', strokeWidth: 2 }));
        s.add(_circle({ x: 494, y: 482, radius: 34, fill: '#b8202c', stroke: '#6d0e15', strokeWidth: 3 }));
        s.add(_circle({ x: 494, y: 482, radius: 20, fill: '#d94a52', stroke: '#8d1b25', strokeWidth: 2 }));
        s.add(_text({ x: 456, y: 520, width: 76, align: 'center', fontSize: 11, fill: '#e8b4b8', text: 'EM STOP' }));

        // 冲车 / 慢转起动 旋钮面板
        s.add(_rect({ x: 560, y: 344, width: 330, height: 186, fill: '#cfe3e4', stroke: '#5f7a7c', strokeWidth: 2 }));
        s.add(_text({ x: 560, y: 350, width: 165, align: 'center', fontSize: 13, fill: '#12324a', text: '自动' }));
        s.add(_text({ x: 725, y: 350, width: 165, align: 'center', fontSize: 13, fill: '#12324a', text: '慢转\n起动' }));
        s.add(_text({ x: 566, y: 478, width: 70, align: 'center', fontSize: 12, fill: '#12324a', text: '冲车' }));
        // 旋钮底座
        s.add(_circle({ x: 725, y: 432, radius: 52, fill: '#2a2d30', stroke: '#0f1112', strokeWidth: 2 }));
        s.add(_circle({ x: 725, y: 432, radius: 22, fill: '#4a4f53', stroke: '#0f1112', strokeWidth: 2 }));

        // 车钟刻度大表盘（STOP | AHEAD | ASTERN）
        const cx = 725, cy = 664, R = 96;
        s.add(_circle({ x: cx, y: cy, radius: R + 12, fill: '#f7f7f7', stroke: '#2a2d30', strokeWidth: 4 }));
        s.add(_circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#8d9498', strokeWidth: 1 }));
        s.add(_text({ x: cx - 40, y: cy - R - 24, width: 80, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#c40000', text: 'STOP' }));
        s.add(_text({ x: cx + 34, y: cy - R - 6, width: 92, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#12324a', text: 'AHEAD' }));
        s.add(_text({ x: cx - 126, y: cy - R - 6, width: 92, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#12324a', text: 'ASTERN' }));
        // 刻度：左右各 0…10
        for (let i = 0; i <= 10; i++) {
            const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2);         // 右侧 AHEAD
            const a2 = -Math.PI / 2 - (i / 10) * (Math.PI / 2);        // 左侧 ASTERN
            const r1 = R - 16, r2 = R - 4;
            s.add(_line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2],
                stroke: '#2a2d30', strokeWidth: i % 5 === 0 ? 2 : 1.2,
            }));
            s.add(_line({
                points: [cx + Math.cos(a2) * r1, cy + Math.sin(a2) * r1, cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2],
                stroke: '#2a2d30', strokeWidth: i % 5 === 0 ? 2 : 1.2,
            }));
            if (i % 2 === 0) {
                s.add(_text({
                    x: cx + Math.cos(a) * (R - 30) - 8, y: cy + Math.sin(a) * (R - 30) - 7, width: 16, align: 'center',
                    fontSize: 11, fill: '#2a2d30', text: String(i),
                }));
                s.add(_text({
                    x: cx + Math.cos(a2) * (R - 30) - 8, y: cy + Math.sin(a2) * (R - 30) - 7, width: 16, align: 'center',
                    fontSize: 11, fill: '#2a2d30', text: String(i),
                }));
            }
        }
        s.add(_circle({ x: cx, y: cy, radius: 30, fill: '#141618', stroke: '#000000', strokeWidth: 2 }));
    }

    /** 右区：三只机旁仪表（白面 + 红绿弧） */
    _drawGauges(s) {
        const box = (x, y, w, h, title) => {
            s.add(_rect({ x, y, width: w, height: h, fill: C_BLUE_BOX, stroke: '#4f7375', strokeWidth: 2 }));
            s.add(_text({ x, y: y + 4, width: w, align: 'center', fontSize: 12.5, fill: '#12324a', text: title }));
        };
        box(1006, 8, 590, 214, '');
        s.add(_text({ x: 1016, y: 14, width: 190, align: 'center', fontSize: 12.5, fill: '#12324a', text: '启动空气压力' }));
        s.add(_text({ x: 1206, y: 14, width: 190, align: 'center', fontSize: 12.5, fill: '#12324a', text: '主机转速' }));
        s.add(_text({ x: 1396, y: 14, width: 190, align: 'center', fontSize: 12.5, fill: '#12324a', text: '动力液压油压力' }));

        this._staticDial(s, { cx: 1110, cy: 130, R: 66, lo: 0, hi: 40, unit: 'bar', labels: 5, redFrom: 0, redTo: 10 });
        this._staticDial(s, { cx: 1300, cy: 130, R: 66, lo: -120, hi: 120, unit: 'rpm', labels: 5, redOuter: true });
        this._staticDial(s, { cx: 1490, cy: 130, R: 66, lo: 0, hi: 400, unit: 'bar', labels: 5, greenTo: 320 });
    }

    /** 白面仪表（含红/绿弧、刻度、数字、单位） */
    _staticDial(s, o) {
        const { cx, cy, R, lo, hi, unit, labels = 5 } = o;
        s.add(_rect({ x: cx - R - 26, y: cy - R - 20, width: (R + 26) * 2, height: (R + 34) * 1.6, fill: '#fdfdfd', stroke: '#2a2d30', strokeWidth: 2 }));
        const arc = (rot, ang, ri, ro, fill) => new Konva.Arc({
            x: cx, y: cy, innerRadius: ri, outerRadius: ro, angle: ang, rotation: rot, fill, listening: false,
        });
        const pct = (v) => (v - lo) / (hi - lo);
        s.add(arc(180, 180, R - 12, R, '#d8d8d8'));
        if (o.redOuter) {
            // 转速表：-120~-60 红、-60~60 绿、60~120 红
            s.add(arc(180, pct(-60) * 180, R - 12, R, C_RED));
            s.add(arc(180 + pct(-60) * 180, (pct(60) - pct(-60)) * 180, R - 12, R, C_GREEN));
            s.add(arc(180 + pct(60) * 180, (1 - pct(60)) * 180, R - 12, R, C_RED));
        } else if (o.redFrom != null) {
            s.add(arc(180 + pct(o.redFrom) * 180, (pct(o.redTo) - pct(o.redFrom)) * 180, R - 12, R, C_RED));
            s.add(arc(180 + pct(o.redTo) * 180, (1 - pct(o.redTo)) * 180 + 0.01, R - 12, R, C_GREEN));
        } else if (o.greenTo != null) {
            s.add(arc(180, pct(o.greenTo) * 180, R - 12, R, C_GREEN));
            s.add(arc(180 + pct(o.greenTo) * 180, (1 - pct(o.greenTo)) * 180, R - 12, R, C_RED));
        } else {
            s.add(arc(180 + pct(hi * 0.5) * 180, 180 * 0.5, R - 12, R, C_GREEN));
        }
        for (let i = 0; i <= 24; i++) {
            const a = Math.PI + (i / 24) * Math.PI;
            const major = i % 6 === 0;
            const r1 = R - 12 - (major ? 9 : 4);
            s.add(_line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * (R - 13), cy + Math.sin(a) * (R - 13)],
                stroke: '#2a2d30', strokeWidth: major ? 1.6 : 0.9,
            }));
        }
        for (let i = 0; i < labels; i++) {
            const t = i / (labels - 1);
            const a = Math.PI + t * Math.PI;
            const v = lo + (hi - lo) * t;
            s.add(_text({
                x: cx + Math.cos(a) * (R + 4) - 18, y: cy + Math.sin(a) * (R + 4) - 8, width: 36, align: 'center',
                fontSize: 11, fill: '#2a2d30', text: String(Math.round(v)),
            }));
        }
        s.add(_text({ x: cx - 24, y: cy + 14, width: 48, align: 'center', fontSize: 11, fill: '#2a2d30', text: unit }));
        // 数值框
        s.add(_rect({ x: cx - 34, y: cy + R - 6, width: 68, height: 22, fill: '#ffffff', stroke: '#2a2d30', strokeWidth: 1.5 }));
    }

    /** 右下：盘车机遥控盒（黄色）+ 盘车机控制箱（浅蓝） */
    _drawTurningGear(s) {
        // 遥控盒
        s.add(_rect({ x: 1006, y: 236, width: 120, height: 556, fill: '#f0c14b', stroke: '#a07a10', strokeWidth: 2, cornerRadius: 4 }));
        s.add(_text({ x: 1006, y: 244, width: 120, align: 'center', fontSize: 13, fill: '#3a2c00', text: '盘车机遥控盒' }));
        [['tg-power', '电源', 312, '#f2f2f2'], ['tg-fwd', '正转', 396, '#111111'], ['tg-rev', '倒转', 480, '#111111'], ['tg-estop', '紧急停止', 570, '#c8232c']]
            .forEach(([id, label, y, fill]) => {
                s.add(_text({ x: 1006, y: y - 40, width: 120, align: 'center', fontSize: 12.5, fill: '#3a2c00', text: label }));
                s.add(_circle({ x: 1066, y, radius: 26, fill: '#2a2d30', stroke: '#7a5f10', strokeWidth: 2 }));
                s.add(_circle({ x: 1066, y, radius: 20, fill, stroke: '#7a5f10', strokeWidth: 1 }));
                void id;
            });
        s.add(_text({ x: 1006, y: 604, width: 120, align: 'center', fontSize: 11, fill: '#c40000', text: '紧急停止' }));

        // 控制箱
        s.add(_rect({ x: 1136, y: 236, width: 460, height: 556, fill: C_BLUE_BOX, stroke: '#4f7375', strokeWidth: 2, cornerRadius: 4 }));
        s.add(_text({ x: 1136, y: 242, width: 460, align: 'center', fontSize: 16, fontStyle: 'bold', fill: '#12324a', text: '盘车机控制箱' }));
        s.add(_text({ x: 1560, y: 244, width: 28, align: 'center', fontSize: 11, fill: '#12324a', text: '3D' }));

        // 电源开关（方形空开）
        s.add(_rect({ x: 1152, y: 274, width: 108, height: 96, fill: '#3a3d40', stroke: '#1f2225', strokeWidth: 2 }));
        s.add(_rect({ x: 1160, y: 282, width: 92, height: 60, fill: '#c9ccce', stroke: '#5f6669', strokeWidth: 1 }));
        s.add(_text({ x: 1160, y: 296, width: 92, align: 'center', fontSize: 11, fill: '#12324a', text: 'ON' }));
        s.add(_text({ x: 1160, y: 326, width: 92, align: 'center', fontSize: 11, fill: '#c40000', text: 'OFF' }));

        // 电流表
        s.add(_rect({ x: 1272, y: 274, width: 150, height: 96, fill: '#fdfdfd', stroke: '#2a2d30', strokeWidth: 2 }));
        s.add(_text({ x: 1362, y: 278, width: 50, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#12324a', text: 'A' }));
        s.add(new Konva.Arc({
            x: 1347, y: 348, innerRadius: 34, outerRadius: 42, angle: 160, rotation: 190, fill: '#c40000', listening: false,
        }));
        s.add(new Konva.Arc({
            x: 1347, y: 348, innerRadius: 34, outerRadius: 42, angle: 20, rotation: 170, fill: '#2a2d30', listening: false,
        }));
        s.add(_line({ points: [1347, 348, 1330, 306], stroke: '#2a2d30', strokeWidth: 2 }));
        s.add(_text({ x: 1290, y: 352, width: 120, align: 'center', fontSize: 10, fill: '#2a2d30', text: '0    5   10' }));

        // 指示灯矩阵 4 列 × 3 行
        TG_LAMPS.forEach(([label, color, key], i) => {
            const c = i % 4, r = Math.floor(i / 4);
            const x = 1170 + c * 108, y = 406 + r * 118;
            s.add(_circle({ x, y, radius: 24, fill: '#2a2d30', stroke: '#4f7375', strokeWidth: 2 }));
            s.add(_circle({ x, y, radius: 18, fill: '#1a1c1e', stroke: '#4f7375', strokeWidth: 1 }));
            s.add(_text({ x: x - 52, y: y + 30, width: 104, align: 'center', fontSize: 11.5, fill: '#12324a', text: label }));
            this._tgLamps.push({ node: null, x, y, color, key });
        });
        // 加热 断 | 通
        s.add(_text({ x: 1446, y: 700, width: 130, align: 'center', fontSize: 12, fill: '#12324a', text: '加热   断 | 通' }));
    }

    _drawStatic() {
        const s = this._staticGroup;
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: '#eceff0' }));
        this._drawLocalBoard(s);
        this._drawMatrix(s);
        this._drawSwitches(s);
        this._drawGauges(s);
        this._drawTurningGear(s);
    }

    // ═══════════════════════════════════════════════════════
    //  动态图形
    // ═══════════════════════════════════════════════════════

    _createDynamic() {
        const d = this._dynamicGroup;

        // 左列圆钮的指示灯
        this._btnLamp = {};
        [['mode-atsea', 92, 62], ['mode-standby', 92, 130], ['mode-fwe', 92, 198],
            ['pos-bridge', 92, 300], ['pos-ecr', 92, 368], ['pos-local', 92, 436],
            ['wrong-way', 92, 540], ['lamp-test', 92, 610]].forEach(([id, x, y]) => {
            const lamp = _circle({ x, y: y - 20, radius: 5, fill: '#3a3f42' });
            d.add(lamp);
            this._btnLamp[id] = lamp;
        });

        // 车钟档位灯
        this._telLamp = TELEGRAPH.map((t, i) => {
            const lamp = _circle({ x: 300, y: 46 + i * 66 - 17, radius: 5, fill: '#3a3f42' });
            d.add(lamp);
            return lamp;
        });

        // 矩阵格子（动态层：亮灯底色 + 文字）
        MATRIX.forEach((row, r) => {
            row.forEach((cell, c) => {
                const x = 442 + c * 128 + 2, y = 12 + r * 62 + 2, w = 124, h = 58;
                const rect = _rect({ x, y, width: w, height: h, fill: C_RED_D });
                d.add(rect);
                const txt = _text({ x: x + 2, y: y + 6, width: w - 4, align: 'center', fontSize: 13, lineHeight: 1.2, fill: '#f0f0f0', text: cell.text });
                d.add(txt);
                this._cells[cell.key] = { rect, txt, color: cell.color, id: cell.id };
            });
        });

        // 试灯 / EM STOP 的灯
        this._testLamp = _circle({ x: 494, y: 358, radius: 4, fill: '#3a3f42' });
        d.add(this._testLamp);

        // 起动旋钮指针（自动 / 慢转起动）
        this._startKnob = new Konva.Group({ x: 725, y: 432, listening: false });
        this._startKnob.add(new Konva.Rect({
            x: -7, y: -42, width: 14, height: 84, cornerRadius: 7,
            fill: 'rgba(0,0,0,0)', stroke: '#f2f2f2', strokeWidth: 2.5, listening: false,
        }));
        this._startKnob.add(new Konva.Rect({ x: -4, y: -40, width: 8, height: 16, fill: '#f2f2f2', listening: false }));
        d.add(this._startKnob);

        // 车钟大表盘指针
        this._telegraphNeedle = new Konva.Group({ x: 725, y: 664, rotation: 0, listening: false });
        this._telegraphNeedle.add(new Konva.Line({ points: [0, 0, 72, 0], stroke: '#20242a', strokeWidth: 6, lineCap: 'round', listening: false }));
        this._telegraphNeedle.add(new Konva.Line({ points: [0, 0, 72, 0], stroke: '#f2c14e', strokeWidth: 3, lineCap: 'round', listening: false }));
        this._telegraphNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 7, fill: '#555b5f', listening: false }));
        d.add(this._telegraphNeedle);

        // 三只仪表指针 + 数值
        this._gauges.air = {
            needle: this._mkNeedle(1110, 130, 54, 4),
            value: _text({ x: 1110 - 34, y: 130 + 60, width: 68, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#12324a', text: '28' }),
        };
        this._gauges.rpm = {
            needle: this._mkNeedle(1300, 130, 54, 4),
            value: _text({ x: 1300 - 34, y: 130 + 60, width: 68, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#12324a', text: '68.0' }),
        };
        this._gauges.hyd = {
            needle: this._mkNeedle(1490, 130, 54, 4),
            value: _text({ x: 1490 - 34, y: 130 + 60, width: 68, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#12324a', text: '280' }),
        };
        d.add(this._gauges.air.value, this._gauges.rpm.value, this._gauges.hyd.value);

        // 盘车机指示灯（动态）
        this._tgLamps.forEach((l) => {
            const node = _circle({ x: l.x, y: l.y, radius: 18, fill: '#1a1c1e' });
            d.add(node);
            l.node = node;
        });

        // 遥控盒电源灯
        this._tgRemoteLamp = _circle({ x: 1066, y: 274, radius: 4, fill: '#3a3f42' });
        d.add(this._tgRemoteLamp);
    }

    _mkNeedle(cx, cy, R, w) {
        const g = new Konva.Group({ x: cx, y: cy, rotation: 180, listening: false });
        g.add(new Konva.Line({ points: [0, 0, R, 0], stroke: '#20242a', strokeWidth: w + 1.5, lineCap: 'round', listening: false }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#20242a', listening: false }));
        this._dynamicGroup.add(g);
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
        mk('mode-atsea', 58, 28, 68, 68, () => { M.engineMode = 'SEA'; this._tip('工况：At Sea'); });
        mk('mode-standby', 58, 96, 68, 68, () => { M.engineMode = 'STANDBY'; this._tip('工况：Stand By'); });
        mk('mode-fwe', 58, 164, 68, 68, () => { M.engineMode = 'FWE'; this._tip('工况：FWE 完车'); });
        mk('pos-bridge', 58, 266, 68, 68, () => this._setPos(CONTROL_POS.BRIDGE));
        mk('pos-ecr', 58, 334, 68, 68, () => this._setPos(CONTROL_POS.ECR));
        mk('pos-local', 58, 402, 68, 68, () => this._setPos(CONTROL_POS.LOCAL));
        mk('wrong-way', 58, 506, 68, 68, () => this._tip('转向不符 Wrong Way 指示'));
        mk('lamp-test', 58, 576, 68, 68, () => { M.lampTest(); this._tip('试灯：全部指示灯点亮 2 s'); });

        // 车钟档位
        TELEGRAPH.forEach((t, i) => {
            mk(`tel-${i}`, 271, 46 + i * 66 - 29, 58, 58, () => {
                const ok = M.stepLever(M.leverIdx - i, CONTROL_POS.LOCAL);
                this._tip(ok ? `车钟：${t.label}` : '当前无操纵权（控制位置不在机旁）');
            });
        });

        // 矩阵格：可操作的按语义绑定
        const cellAt = (id) => {
            let out = null;
            MATRIX.forEach((row, r, ) => row.forEach((c, ci) => { if (c.id === id) out = { x: 442 + ci * 128, y: 12 + r * 62 }; }));
            return out;
        };
        const mkCell = (id, onClick) => {
            const p = cellAt(id);
            if (p) mk(id, p.x, p.y, 128, 62, onClick);
        };
        mkCell('mx-local', () => this._setPos(CONTROL_POS.LOCAL));
        mkCell('mx-ecr', () => this._setPos(CONTROL_POS.ECR));
        mkCell('mx-bridge', () => this._setPos(CONTROL_POS.BRIDGE));
        mkCell('mx-force', () => { M.forceTakeControl(); this._tip('控制权强制获取：机旁接管'); });
        mkCell('mx-sld-req', () => { M.slowDownReq = !M.slowDownReq; this._tip(M.slowDownReq ? '手动降速请求' : '取消双降速请求'); });
        mkCell('mx-sld-act', () => this._tip('降速激活（自动减速动作中）'));
        mkCell('mx-sld-cancel', () => { M.cancelSafety('SLD'); this._tip('降速取消：越控自动减速'); });
        mkCell('mx-sld-reset', () => { M.slowDown = false; M.slowDownReq = false; this._tip('降速复位'); });
        mkCell('mx-sd-act', () => this._tip('停车激活（自动停车动作中）'));
        mkCell('mx-sd-cancel', () => { M.cancelSafety('SHD'); M.shutDown = false; this._tip('停车取消'); });
        mkCell('mx-blower-run', () => this._tip('辅助鼓风机运行中'));
        mkCell('mx-blower-alarm', () => this._tip('辅助鼓风机报警'));
        mkCell('mx-turn-out', () => { M.toggleTurningGear(); this._tip(M.turningGearOut ? '盘车机已脱开' : '盘车机已合上'); });
        mkCell('mx-air-dist', () => this._tip('空气分配器在工作位'));
        mkCell('mx-main-valve', () => this._tip('主起动阀在工作位'));
        mkCell('mx-not-ready', () => this._tip('主机备车未完成'));
        mkCell('mx-lim-act', () => { M.toggleLoadLimit(); this._tip(M.loadLimit ? '负荷限制激活' : '负荷限制解除'); });
        mkCell('mx-lim-up', () => { M.loadLimitUp = !M.loadLimitUp; this._tip('负荷限制增高'); });
        mkCell('mx-start-block', () => this._tip('起动阻塞：盘车机/空气分配器/主起动阀不在位'));
        mkCell('mx-start-fail', () => this._tip('起动失败'));

        // 试灯 / EM STOP / 起动旋钮
        mk('test-lamp', 446, 344, 96, 74, () => { M.lampTest(); this._tip('试灯'); });
        mk('em-stop', 446, 434, 96, 96, () => { M.emergencyStop(); this._tip('机旁应急停车 EM STOP'); });
        mk('start-auto', 620, 344, 210, 186, () => {
            const ok = M.startEngine(false);
            this._tip(ok ? '自动起动：主起动阀开启，主机起动' : (M.alarmText || '起动被阻止'));
        });
        mk('slow-turn', 830, 344, 60, 186, () => {
            const ok = M.startEngine(true);
            this._tip(ok ? '慢转起动（冲车）' : (M.alarmText || '起动被阻止'));
        });
        mk('blow', 560, 470, 330, 34, () => this._tip('冲车：不点火转动主机，吹出气缸积水'));

        // 遥控盒
        mk('tg-power', 1040, 274, 52, 52, () => { M.toggleTurningGear(); this._tip(M.turningGearOut ? '盘车机电源断开，盘车机脱开' : '盘车机电源接通，盘车机合上'); });
        mk('tg-fwd', 1040, 346, 52, 52, () => this._tip('盘车机正转'));
        mk('tg-rev', 1040, 418, 52, 52, () => this._tip('盘车机倒转'));
        mk('tg-estop', 1040, 494, 52, 52, () => { M.emergencyStop(); this._tip('遥控盒紧急停止'); });

        // 控制箱
        mk('ts-power', 1152, 274, 108, 96, () => { M.toggleTurningGear(); this._tip(M.turningGearOut ? '盘车机控制箱：断开（脱开）' : '盘车机控制箱：合上'); });
        mk('ts-mode-local', 1310, 396, 80, 80, () => { this._setPos(CONTROL_POS.LOCAL); this._tip('盘车机控制：本地'); });
        mk('ts-mode-remote', 1418, 396, 80, 80, () => { this._setPos(CONTROL_POS.ECR); this._tip('盘车机控制：遥控'); });
        mk('ts-heat', 1500, 640, 90, 40, () => this._tip('空间加热：通（防凝露）'));
    }

    _setPos(pos) {
        const M = this.model;
        const ok = M.setControlPos(pos);
        const name = { BRIDGE: '驾驶台', ECR: '集控室', LOCAL: '机旁' }[pos];
        this._tip(ok ? `控制位置切到${name}` : `控制位置已在${name}`);
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

        // 左列圆钮指示灯
        const lampOn = (on, color) => (on ? color : '#3a3f42');
        this._btnLamp['mode-atsea'].fill(lampOn(M.engineMode === 'SEA', C_GREEN));
        this._btnLamp['mode-standby'].fill(lampOn(M.engineMode === 'STANDBY', C_GREEN));
        this._btnLamp['mode-fwe'].fill(lampOn(M.engineMode === 'FWE', C_GREEN));
        this._btnLamp['pos-bridge'].fill(lampOn(M.controlPos === CONTROL_POS.BRIDGE, C_GREEN));
        this._btnLamp['pos-ecr'].fill(lampOn(M.controlPos === CONTROL_POS.ECR, C_AMBER));
        this._btnLamp['pos-local'].fill(lampOn(M.controlPos === CONTROL_POS.LOCAL, C_GREEN));
        this._btnLamp['wrong-way'].fill(lampOn(M.wrongWay, C_RED));
        this._btnLamp['lamp-test'].fill(lampOn(M.lampTest, C_AMBER));

        // 车钟档位灯（当前档常亮）
        this._telLamp.forEach((n, i) => n.fill(i === M.leverIdx ? C_GREEN : '#3a3f42'));

        // 矩阵状态
        const S = {
            local: M.controlPos === CONTROL_POS.LOCAL,
            ecr: M.controlPos === CONTROL_POS.ECR,
            bridge: M.controlPos === CONTROL_POS.BRIDGE,
            force: M.forceTake,
            sldReq: M.slowDownReq,
            sldAct: M.slowDown && !M.cancelSLD,
            sldCancel: M.cancelSLD,
            sldReset: false,
            sdAct: M.shutDown && !M.cancelSHD,
            sdCancel: M.cancelSHD,
            blowerRun: M.auxBlower,
            blowerAlarm: M.auxBlowerAlarm,
            turnOut: M.turningGearOut,
            airDist: M.airDistributorOk,
            mainValve: M.mainStartValveOk,
            notReady: !M.engineReady,
            limAct: M.loadLimit && !M.cancelLimits,
            limUp: M.loadLimitUp,
            startBlock: M.startBlocked,
            startFail: M.startFail,
        };
        const blinkOn = M.blink;
        Object.entries(this._cells).forEach(([key, cell]) => {
            const on = !!S[key];
            // 报警类（红）未确认时闪烁；状态类常亮
            const isAlarm = cell.color === C_RED;
            const lit = isAlarm ? (on && (M.acked || blinkOn)) : on;
            cell.rect.fill(lit ? cell.color : (isAlarm ? C_RED_D : C_GREEN_D));
            cell.txt.fill(lit ? (cell.color === C_GREEN ? '#06240c' : '#ffffff') : '#9aa3a6');
        });

        // 试灯
        this._testLamp.fill(M.lampTest ? C_AMBER : '#3a3f42');

        // 起动旋钮（起动中指向斜下 = 自动；慢转时指向右）
        this._startKnob.rotation(M.starting ? (M.slowTurning ? 45 : -45) : 0);

        // 车钟大表盘指针
        const pct = Math.max(-1, Math.min(1, M.rpmCmd / 120));
        this._telegraphNeedle.rotation(pct * 90);

        // 三只仪表
        this._gauges.air.needle.rotation(this._angleFor(M.startAir, 0, 40));
        this._gauges.air.value.text(String(Math.round(M.startAir)));
        this._gauges.rpm.needle.rotation(this._angleFor(M.rpm, -120, 120));
        this._gauges.rpm.value.text(M.rpm.toFixed(1));
        this._gauges.hyd.needle.rotation(this._angleFor(M.hydOil, 0, 400));
        this._gauges.hyd.value.text(String(Math.round(M.hydOil)));

        // 盘车机指示灯
        const tgOn = {
            overload: false, power: !M.turningGearOut, heater: true, spare: false,
            fwd: false, rev: false, remote: M.controlPos !== CONTROL_POS.LOCAL, local: M.controlPos === CONTROL_POS.LOCAL,
            fwd2: false, rev2: false, local2: M.controlPos === CONTROL_POS.LOCAL, remote2: M.controlPos !== CONTROL_POS.LOCAL,
        };
        this._tgLamps.forEach((l) => {
            const on = !!tgOn[l.key];
            l.node.fill(on ? l.color : '#1a1c1e');
        });
        this._tgRemoteLamp.fill(M.controlPos !== CONTROL_POS.LOCAL ? C_GREEN : '#3a3f42');

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
