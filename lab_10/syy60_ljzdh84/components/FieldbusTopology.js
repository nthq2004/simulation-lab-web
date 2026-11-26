import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * FieldbusTopology — 现场总线型机舱监视与报警系统结构图（K-Chief 600 典型拓扑）
 * ═══════════════════════════════════════════════════════════════
 *  按参考结构图绘制（1340 × 980）：
 *    ① 住舱 / 驾驶台：WCU ×2（住舱）、OS（住舱）、WBU（驾驶台）、OS（驾驶台）
 *    ② 集控室：OS/SGW ×2、Printer、UPS，三条总线 CAN Bus 3 / Ethernet 2 / Ethernet 1
 *    ③ 机舱：CAN Bus 2 / CAN Bus 1，dPSC 分布式处理单元
 *        上排：RDi-32、RDi-32、RDo-16、…、RAi-16、dPSC
 *        下排：RAi-16、RAo-8、RAi-10tc、LOS、MOS、RIO-C4
 *
 *  可点击部件（工作流 find 的 subTarget）：
 *    wcu-1 wcu-2 os-cabin wbu os-bridge
 *    os-sgw-1 os-sgw-2 printer ups
 *    can1 can2 can3 eth1 eth2
 *    dp-rdi1 dp-rdi2 dp-rdo dp-rai1 dpsc dp-rai2 dp-rao dp-rai10 los mos rio
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1340, H = 860;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Microsoft YaHei, Arial' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));

export class FieldbusTopology extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;

        this.type = 'fieldbus_topology';
        this.cache = 'fixed';

        this._initGroups();
        this._init();
        this.config = { id: this.id };
    }

    _tip() { /* 按用户要求不弹提示 */ }

    _init() {
        this._drawStatic();
        this._addDragPlate();
        this._bindInteraction();
    }

    /** 整块拖动热区（静态图形均 listening:false） */
    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
        this.group.draggable(true);
    }

    // ═══════════════════════════════════════════════════════
    //  图元
    // ═══════════════════════════════════════════════════════

    /** OS 操作站：显示器 + 底座 + 机箱 */
    _os(s, x, y, label) {
        // 显示器
        s.add(_rect({ x, y, width: 118, height: 86, fill: '#ffffff', stroke: '#111111', strokeWidth: 2 }));
        s.add(_rect({ x: x + 9, y: y + 8, width: 100, height: 70, fill: '#f2f4f5', stroke: '#333333', strokeWidth: 1.4 }));
        // 底座（居中：显示器宽 118，中心 x+59）
        s.add(_line({ points: [x + 59, y + 86, x + 59, y + 96], stroke: '#111111', strokeWidth: 2 }));
        s.add(_line({ points: [x + 43, y + 96, x + 75, y + 96], stroke: '#111111', strokeWidth: 2 }));
        // 机箱
        s.add(_rect({ x: x - 6, y: y + 98, width: 130, height: 24, fill: '#ffffff', stroke: '#111111', strokeWidth: 2 }));
        s.add(_line({ points: [x - 2, y + 106, x + 118, y + 106], stroke: '#8a9196', strokeWidth: 1 }));
        s.add(_line({ points: [x - 2, y + 113, x + 118, y + 113], stroke: '#8a9196', strokeWidth: 1 }));
        if (label) s.add(_text({ x: x - 10, y: y - 26, width: 140, align: 'center', fontSize: 17, fill: '#111111', text: label }));
    }

    /** 小面板（WCU / WBU / LOS / MOS） */
    _panel(s, x, y, w, h, label, opts = {}) {
        s.add(_rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: '#111111', strokeWidth: 2, cornerRadius: 3 }));
        // 左侧小屏
        s.add(_rect({ x: x + 8, y: y + 8, width: w * 0.45, height: h - 16, fill: '#f2f4f5', stroke: '#333333', strokeWidth: 1.2 }));
        if (opts.knobs !== false) {
            s.add(new Konva.Circle({ x: x + w - 22, y: y + h / 2 - 7, radius: 6, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.4, listening: false }));
            s.add(new Konva.Circle({ x: x + w - 22, y: y + h / 2 + 9, radius: 6, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.4, listening: false }));
        }
        if (label) s.add(_text({ x: x - 10, y: y + h + 4, width: w + 20, align: 'center', fontSize: 16, fill: '#111111', text: label }));
    }

    /** 打印机 */
    _printer(s, x, y) {
        s.add(_rect({ x, y: y + 18, width: 76, height: 40, fill: '#ffffff', stroke: '#111111', strokeWidth: 2, cornerRadius: 3 }));
        s.add(_line({ points: [x + 8, y + 18, x + 14, y + 2, x + 62, y + 2, x + 68, y + 18], closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.6 }));
        s.add(_rect({ x: x + 14, y: y + 30, width: 48, height: 8, fill: '#f2f4f5', stroke: '#333333', strokeWidth: 1 }));
        s.add(_text({ x: x - 16, y: y - 26, width: 110, align: 'center', fontSize: 17, fill: '#111111', text: 'Printer' }));
    }

    /** UPS 机柜 */
    _ups(s, x, y) {
        s.add(_line({
            points: [x, y + 12, x + 10, y, x + 58, y, x + 68, y + 12, x + 68, y + 96, x, y + 96],
            closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 2,
        }));
        s.add(_line({ points: [x + 4, y + 22, x + 64, y + 22], stroke: '#111111', strokeWidth: 1.4 }));
        for (let i = 0; i < 4; i++) {
            s.add(_rect({ x: x + 10, y: y + 32 + i * 14, width: 46, height: 8, fill: '#f2f4f5', stroke: '#333333', strokeWidth: 0.9 }));
        }
        s.add(_text({ x: x - 14, y: y + 102, width: 96, align: 'center', fontSize: 17, fill: '#111111', text: 'UPS' }));
    }

    /** dPSC 现场模块（斜视盒体 + 深色面板 + 引脚线） */
    _module(s, x, y, label, pins, labelShift, labelShiftY) {
        const w = 96, h = 34, d = 14;
        // 顶面
        s.add(_line({
            points: [x, y, x + d, y - d, x + w + d, y - d, x + w, y],
            closed: true, fill: '#f6f7f8', stroke: '#111111', strokeWidth: 1.8,
        }));
        // 前面
        s.add(_line({
            points: [x, y, x + w, y, x + w, y + h, x, y + h],
            closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.8,
        }));
        // 深色显示窗
        s.add(_rect({ x: x + 8, y: y + 8, width: 34, height: h - 16, fill: '#2b3134', stroke: '#111111', strokeWidth: 1 }));
        // 指示灯
        for (let i = 0; i < 3; i++) {
            s.add(_rect({ x: x + 50 + i * 12, y: y + 8, width: 8, height: 8, fill: '#2b3134', stroke: '#111111', strokeWidth: 0.8 }));
        }
        // 引脚线（默认 3 根，可传入绝对 x 数组自定义）
        (pins || [x + 18, x + 40, x + 62]).forEach((px) => {
            s.add(_line({ points: [px, y + h, px, y + h + 22], stroke: '#111111', strokeWidth: 1.6 }));
        });
        if (label) s.add(_text({ x: x - 16 + (labelShift || 0), y: y + h + 26 + (labelShiftY || 0), width: w + 32, align: 'center', fontSize: 16, fill: '#111111', text: label }));
    }

    /** 总线（水平粗线 + 名称） */
    _bus(s, x1, x2, y, label, labelX, align, color, dash) {
        s.add(_line(dash
            ? { points: [x1, y, x2, y], stroke: color || '#111111', strokeWidth: 3.4, dash }
            : { points: [x1, y, x2, y], stroke: color || '#111111', strokeWidth: 3.4 }));
        s.add(_text({ x: labelX == null ? x1 + 60 : labelX, y: y - 24, width: 300, align: align || 'left', fontSize: 17, fill: '#111111', text: label }));
    }

    /** 分区虚线框 + 区域名 */
    _zone(s, x, y, w, h, label) {
        s.add(_rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', stroke: '#333333', strokeWidth: 0.4, dash: [10, 10] }));
        if (label) s.add(_text({ x: x + 8, y: y + 6, width: 200, fontSize: 18, fill: '#111111', text: label }));
    }

    _drawStatic() {
        const s = this._staticGroup;
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: '#ffffff', stroke: '#c0c6c9', strokeWidth: 1 }));

        // 三个分区的纵向基准（相邻分区共用同一条分隔虚线）
        const Y1 = 10, H1 = 240;    // 住舱 / 驾驶台 → 10..250
        const Y2 = 250, H2 = 240;   // 集控室 → 250..490
        const Y3 = 490, H3 = 360;   // 机舱 → 490..850
        const Y4 = 767;             // 机舱第二排（RAi-16 起 6 个部件）
        const TR = Y1 + 34;         // 顶部汇总干线 y = 54
        const VX = 110;             // 左侧竖干线（住舱侧）
        const DASH = { stroke: '#333333', strokeWidth: 0.4, dash: [10, 10] };

        // ── 分区（外框 + 共用分隔虚线：线宽 0.4、线段 10、间隙 10）──
        this._zone(s, 20, Y1, 1300, Y3 + H3 - Y1, '');
        s.add(_line(Object.assign({ points: [20, Y2, 1320, Y2] }, DASH)));   // 住舱/驾驶台 ↔ 集控室
        s.add(_line(Object.assign({ points: [20, Y3, 1320, Y3] }, DASH)));   // 集控室 ↔ 机舱
        s.add(_line(Object.assign({ points: [710, Y1, 710, Y2] }, DASH)));   // 住舱 | 驾驶台
        s.add(_text({ x: 30, y: Y1 + 6, width: 100, fontSize: 18, fill: '#111111', text: '住舱' }));
        s.add(_text({ x: 720, y: Y1 + 6, width: 100, fontSize: 18, fill: '#111111', text: '驾驶台' }));
        s.add(_text({ x: 28, y: Y2 + 6, width: 200, fontSize: 18, fill: '#111111', text: '集控室' }));
        s.add(_text({ x: 28, y: Y3 + 6, width: 200, fontSize: 18, fill: '#111111', text: '机舱' }));

        // ── ① 住舱 / 驾驶台 ──
        this._panel(s, 150, Y1 + 58, 104, 56, 'WCU');      // 78..134
        this._panel(s, 150, Y1 + 142, 104, 56, 'WCU');     // 162..218
        this._os(s, 470, Y1 + 56, '');                     // 显示器 76..162、机箱 174..198
        s.add(_text({ x: 460, y: Y1 + 10, width: 140, align: 'center', fontSize: 17, fill: '#111111', text: 'OS' }));
        this._panel(s, 830, Y1 + 46, 112, 58, '');         // 66..124
        s.add(_text({ x: 820, y: Y1 + 10, width: 132, align: 'center', fontSize: 17, fill: '#111111', text: 'WBU' }));
        this._os(s, 1090, Y1 + 56, '');
        s.add(_text({ x: 1080, y: Y1 + 10, width: 140, align: 'center', fontSize: 17, fill: '#111111', text: 'OS' }));

        // ── ② 集控室 ──
        this._os(s, 150, Y2 + 36, 'OS/SGW');               // 显示器 306..392、机箱 404..428
        this._printer(s, 430, Y2 + 36);                    // 机身 324..364
        this._ups(s, 850, Y2 + 10);                        // 280..376
        this._os(s, 1070, Y2 + 36, 'OS/SGW');

        // ── ③ 机舱：dPSC 模块 ──
        this._module(s, 132, Y3 + 108, 'RDi-32');          // 顶面 604、前面 618..652、引脚 →674
        this._module(s, 312, Y3 + 108, 'RDi-32');
        this._module(s, 502, Y3 + 108, 'RDo-16');
        this._module(s, 892, Y3 + 108, 'RAi-16');
        this._module(s, 1090, Y3 + 108, 'dPSC', [], -30, -20);

        this._module(s, 130, Y4, 'RAi-16');                // 顶面 738、前面 752..786
        this._module(s, 320, Y4, 'RAo-8');
        this._module(s, 510, Y4, 'RAi-10tc');
        this._panel(s, 685, Y4 + 8, 96, 46, 'LOS');        // 760..806
        this._panel(s, 815, Y4 + 6, 110, 52, 'MOS');       // 758..810
        this._module(s, 995, Y4, 'RIO-C4');

        // 省略号（模块排中间的 …）
        for (let i = 0; i < 6; i++) {
            s.add(new Konva.Circle({ x: 640 + i * 16, y: Y3 + 124, radius: 3, fill: '#111111', listening: false }));
        }

        // ── 总线 ──
        this._bus(s, 176, 1134, Y3 + 32, 'CAN Bus 2', 519, 'center', '#00b300', [12, 6]);
        this._bus(s, 204, 1162, Y3 + 66, 'CAN Bus 1', 519, 'center', '#00b300');

        // ── 连线 ──
        const L = (pts, w = 1.6, color = '#111111', dash) => s.add(_line(
            dash ? { points: pts, stroke: color, strokeWidth: w, dash } : { points: pts, stroke: color, strokeWidth: w }));

        // ① 顶部干线：WBU → 最左端
        L([VX, TR, 886, TR], 3.4, '#ff1a1a');
        // ② 左竖干线向下 → 距下 WCU 下边缘 35px 处向右折 → 下接 CAN Bus 3（距其左端 50px）
        L([VX, TR, VX, Y1 + 233, 334, Y1 + 233, 334, Y2 + 146], 3.4, '#ff1a1a');
        // ③ 两台 WCU 从左侧接入竖干线
        L([150, Y1 + 86, VX, Y1 + 86], 3.4, '#ff1a1a');
        L([150, Y1 + 170, VX, Y1 + 170], 3.4, '#ff1a1a');
        // ④ WBU 顶部接入干线
        L([886, Y1 + 46, 886, TR], 3.4, '#ff1a1a');

        // ⑥ CAN Bus 3：左 OS/SGW 右侧中点 ↔ 右 OS/SGW 左侧中点（标注在线中心上方）
        L([274, Y2 + 146, 1064, Y2 + 146], 3.4, '#ff1a1a');
        s.add(_text({ x: 569, y: Y2 + 118, width: 200, align: 'center', fontSize: 17, fill: '#111111', text: 'CAN Bus 3' }));

        // ⑨ Ethernet 2：集控室左主机 3/4 → 右主机 1/2 → 向上 → 住舱 OS / 驾驶台 OS
        L([252, Y2 + 158, 252, Y2 + 190], 2.4, '#1565c0', [12, 6]);      // 左主机下边 3/4 向下
        L([252, Y2 + 190, 1220, Y2 + 190], 2.4, '#1565c0', [12, 6]);     // 向右
        L([1129, Y2 + 158, 1129, Y2 + 190], 2.4, '#1565c0', [12, 6]);    // 右主机下边 1/2 向下汇入
        L([1220, Y2 + 190, 1220, Y1 + 203], 2.4, '#1565c0', [12, 6]);    // 向上（驾驶台 OS 下边缘下方 15px）
        L([1220, Y1 + 203, 551, Y1 + 203], 2.4, '#1565c0', [12, 6]);     // 向左
        L([551, Y1 + 203, 551, Y1 + 178], 2.4, '#1565c0', [12, 6]);      // 向上接住舱 OS 下边缘 2/3
        L([1171, Y1 + 178, 1171, Y1 + 203], 2.4, '#1565c0', [12, 6]);    // 驾驶台 OS 下边缘 2/3 引线
        s.add(_text({ x: 524, y: Y2 + 164, width: 300, align: 'center', fontSize: 17, fill: '#111111', stroke: '#ffffff', strokeWidth: 4, fillAfterStrokeEnabled: true, text: 'Ethernet 2' }));

        // ⑩ Ethernet 1：集控室左主机 1/2 → 右主机 3/4 → 向上 → 住舱 OS / 驾驶台 OS
        L([219, Y2 + 158, 219, Y2 + 210], 2.4, '#1e90ff');      // 左主机下边 1/2 向下
        L([219, Y2 + 210, 1240, Y2 + 210], 2.4, '#1e90ff');     // 向右
        L([1096, Y2 + 158, 1096, Y2 + 210], 2.4, '#1e90ff');    // 右主机下边 1/4 向下汇入
        L([1240, Y2 + 210, 1240, Y1 + 218], 2.4, '#1e90ff');    // 向上（Ethernet 2 右侧 20px）
        L([1240, Y1 + 218, 507, Y1 + 218], 2.4, '#1e90ff');     // 向左
        L([507, Y1 + 218, 507, Y1 + 178], 2.4, '#1e90ff');      // 向上接住舱 OS 下边缘 1/3
        L([1127, Y1 + 178, 1127, Y1 + 218], 2.4, '#1e90ff');    // 驾驶台 OS 下边缘 1/3 引线
        s.add(_text({ x: 524, y: Y2 + 212, width: 300, align: 'center', fontSize: 17, fill: '#111111', stroke: '#ffffff', strokeWidth: 4, fillAfterStrokeEnabled: true, text: 'Ethernet 1' }));

        // ⑨ 集控室左主机下边 1/4 → 穿过 CAN Bus 2 → 继续向下接第一个 RDi-32 顶面（x=186）
        L([176, Y2 + 158, 176, Y3 + 94], 3.4, '#00b300', [12, 6]);
        // ⑩ 集控室右主机下边 3/4（x=1162）向下接 CAN Bus 1
        L([1162, Y2 + 158, 1162, Y3 + 66], 3.4, '#00b300');
        // ⑪ 上排 5 个模块：上边 2/3 位置向上接 CAN Bus 1
        [204, 384, 574, 964, 1162].forEach((x) => L([x, Y3 + 66, x, Y3 + 94], 3.4, '#00b300'));
        // ⑫ 每个模块左侧（x+44）再各引一根线接 CAN Bus 2（第一个模块由左主机 1/4 引线承担）
        [356, 546, 936, 1134].forEach((x) => L([x, Y3 + 32, x, Y3 + 94], 3.4, '#00b300', [12, 6]));
        // ⑪ Local CAN Bus 1（绿色实线，同 CAN Bus 1）：水平线 + 下排各部件引线
        L([214, Y3 + 234, 1079, Y3 + 234], 3.4, '#00b300');
        s.add(_text({ x: 542, y: Y3 + 212, width: 300, align: 'center', fontSize: 17, fill: '#111111', text: 'Local CAN Bus 1' }));
        [130, 320, 510].forEach((x) => L([x + 84, Y3 + 234, x + 84, Y4 - 14], 3.4, '#00b300'));   // 避开第一排标签文字
        L([769, Y3 + 234, 769, Y4 + 8], 3.4, '#00b300');              // LOS
        L([899, Y3 + 234, 899, Y4 + 6], 3.4, '#00b300');              // MOS
        L([1079, Y3 + 234, 1079, Y4 - 14], 3.4, '#00b300');           // RIO-C4
        // dPSC 下边缘右侧引线：向下 → 向左并入 Local CAN Bus 1
        L([1162, Y3 + 142, 1162, Y3 + 234, 1079, Y3 + 234], 3.4, '#00b300');
        // ⑫ Local CAN Bus 2（绿色虚线，同 CAN Bus 2）：dPSC 左侧引脚向下 → 水平线 → 各部件引线
        L([1134, Y3 + 142, 1134, Y3 + 192], 3.4, '#00b300', [12, 6]);
        L([1134, Y3 + 192, 176, Y3 + 192], 3.4, '#00b300', [12, 6]);
        L([176, Y3 + 192, 176, Y4 - 14], 3.4, '#00b300', [12, 6]);
        L([352, Y3 + 192, 352, Y4 - 14], 3.4, '#00b300', [12, 6]);      // RAo-8
        L([542, Y3 + 192, 542, Y4 - 14], 3.4, '#00b300', [12, 6]);      // RAi-10tc
        L([717, Y3 + 192, 717, Y4 + 8], 3.4, '#00b300', [12, 6]);       // LOS
        L([852, Y3 + 192, 852, Y4 + 6], 3.4, '#00b300', [12, 6]);       // MOS
        L([1027, Y3 + 192, 1027, Y4 - 14], 3.4, '#00b300', [12, 6]);    // RIO-C4
        s.add(_text({ x: 545, y: Y3 + 168, width: 300, align: 'center', fontSize: 17, fill: '#111111', text: 'Local CAN Bus 2' }));
    }

    /** 设备热区（供工作流识别 / 点击） */
    _bindInteraction() {
        const parts = [
            ['wcu-1', 150, 68, 104, 56],
            ['wcu-2', 150, 152, 104, 56],
            ['os-cabin', 460, 40, 140, 150],
            ['wbu', 830, 56, 112, 58],
            ['os-bridge', 1080, 40, 140, 150],
            ['os-sgw-1', 140, 266, 140, 150],
            ['printer', 410, 266, 110, 90],
            ['ups', 836, 260, 96, 120],
            ['os-sgw-2', 1060, 266, 140, 150],
            ['can3', 274, 384, 790, 24],
            ['eth2', 252, 428, 968, 24],
            ['eth1', 219, 448, 1021, 24],
            ['can2', 176, 502, 958, 24],
            ['can1', 204, 536, 958, 24],
            ['dp-rdi1', 132, 584, 96, 60],
            ['dp-rdi2', 312, 584, 96, 60],
            ['dp-rdo', 502, 584, 96, 60],
            ['dp-rai1', 892, 584, 96, 60],
            ['dpsc', 1090, 584, 96, 60],
            ['dp-rai2', 130, 753, 96, 60],
            ['dp-rao', 320, 753, 96, 60],
            ['dp-rai10', 510, 753, 96, 60],
            ['los', 685, 775, 96, 46],
            ['mos', 815, 773, 110, 52],
            ['rio', 995, 753, 96, 60],
        ];
        parts.forEach(([id, x, y, w, h]) => this.addClickablePart(id, x, y, w, h));
    }
}
