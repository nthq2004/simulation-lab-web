import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { ac600Of, CONTROL_POS } from '../tools/AC600Solver.js';

/**
 * Ac600Mimic — 主机遥控系统 AC 600 系统结构 MIMIC（现场总线型）
 * ═══════════════════════════════════════════════════════════════
 *  1600 × 800 结构图（照 MAN B&W AC 600 系统结构版式）：
 *    · PORT WING / STB. WING：Bridge Wing Manoeuvring Unit（两翼操纵单元）
 *    · BRIDGE：Bridge Unit + Order Printer（驾驶台操纵单元与命令打印机）
 *    · CONTROL ROOM：Control Room Manoeuvring Unit、Start/Stop Speedset Lever、
 *      Indicating Panel Unit（集控室操纵单元、启停/转速给定手柄、指示面板单元）
 *    · 双 CAN 总线（Dual CAN）连接驾驶台与集控室、机舱
 *    · ENGINE ROOM：Local Control Panel with Engine Telegraph（机旁操纵台）、
 *      Slow Down RAI16、Main Engine Interface MEI、Engine Safety Unit ESU、
 *      nn. 辅助模块、Digital Governor Unit DGU + Servo Unit、Dual RPM Units、
 *      RPM Detectors、Electric Actuator、MAN B&W MC 主机与螺旋桨
 *
 *  状态来自 sys.ac600：控制位置（Bridge / ECR / Local）在对应单元上亮灯，
 *  主机运行时 DGU 伺服、电动执行器、转速检测、螺旋桨转动。
 *
 *  部件 id：bw-port bw-stb bridge-unit order-printer cr-unit cr-lever cr-indicator
 *          local-panel mei esu rai dgu servo rpm-units actuator engine prop
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1600, H = 800;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Arial, Microsoft YaHei' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_BG = '#f0f2f4';
const C_BOX = '#dfe3e6';
const C_BOX_D = '#b6bcc2';
const C_EDGE = '#5f6a73';
const C_CAN = '#3c4550';
const C_GREEN = '#1faa3c';

export class Ac600Mimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;
        this.type = 'ac600_mimic';
        this.cache = 'fixed';

        this.model = ac600Of(sys);

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
    //  图元
    // ═══════════════════════════════════════════════════════

    /** 设备框（灰底 + 边框 + 标题 + 副标题） */
    _box(s, x, y, w, h, title, sub) {
        s.add(_rect({ x, y, width: w, height: h, fill: C_BOX, stroke: C_EDGE, strokeWidth: 1.6, cornerRadius: 3 }));
        s.add(_rect({ x: x + 3, y: y + 3, width: w - 6, height: 16, fill: '#cfd4d9', stroke: C_BOX_D, strokeWidth: 1, cornerRadius: 2 }));
        s.add(_text({ x: x + 4, y: y + 3, width: w - 8, align: 'center', fontSize: 11.5, fill: '#1b1f23', text: title }));
        if (sub) s.add(_text({ x: x + 4, y: y + 22, width: w - 8, align: 'center', fontSize: 10.5, fill: '#3d464e', text: sub }));
    }

    /** 双 CAN 总线（两条平行粗线） */
    _dualCan(s, pts, gap = 7) {
        s.add(_line({ points: pts, stroke: C_CAN, strokeWidth: 4, lineCap: 'round', lineJoin: 'round' }));
        s.add(_line({ points: pts.map((v, i) => (i % 2 === 0 ? v + gap : v + gap)), stroke: C_CAN, strokeWidth: 2.4, lineCap: 'round', lineJoin: 'round', opacity: 0.75 }));
    }

    /** 区域标题 */
    _zone(s, x, y, text, w = 300) {
        s.add(_text({ x, y, width: w, align: 'center', fontSize: 19, fontStyle: 'bold', fill: '#1b1f23', text }));
    }

    // ═══════════════════════════════════════════════════════
    //  静态图
    // ═══════════════════════════════════════════════════════

    _drawStatic() {
        const s = this._staticGroup;
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: C_BG }));

        // ── 驾驶台区域 ──
        this._zone(s, 60, 8, 'PORT WING', 260);
        this._zone(s, 600, 4, 'BRIDGE', 260);
        this._zone(s, 1200, 8, 'STB. WING', 260);

        // 两翼操纵单元
        this._box(s, 60, 40, 260, 120, 'Bridge Wing', 'Manoeuvring Unit');
        this._box(s, 1200, 40, 260, 120, 'Bridge Wing', 'Manoeuvring Unit');

        // 驾驶台操纵单元 + 命令打印机
        this._box(s, 620, 30, 300, 150, 'Bridge Unit', '驾驶台操纵单元');
        this._box(s, 470, 40, 120, 70, 'Order', 'Printer');

        // ── 集控室区域 ──
        this._zone(s, 470, 212, 'CONTROL ROOM', 460);
        this._box(s, 470, 246, 260, 130, 'Control Room', 'Manoeuvring Unit');
        this._box(s, 760, 246, 110, 130, 'Start/Stop', 'Speedset Lever');
        s.add(_rect({ x: 800, y: 292, width: 10, height: 60, fill: '#b6bcc2', stroke: C_EDGE, strokeWidth: 1.2 }));
        s.add(_rect({ x: 792, y: 300, width: 26, height: 12, fill: '#6b7681', stroke: C_EDGE, strokeWidth: 1.2, cornerRadius: 2 }));
        this._box(s, 900, 246, 200, 130, 'Indicating Panel', 'Unit');

        // ── 机舱区域 ──
        this._zone(s, 210, 404, 'ENGINE ROOM', 380);

        // 机旁操纵台
        this._box(s, 40, 470, 240, 200, 'Local Control Panel', 'with Engine Telegraph');

        // 主机（MAN B&W MC）
        const engX = 470, engY = 470, engW = 470, engH = 220;
        s.add(_rect({ x: engX, y: engY, width: engW, height: engH, fill: '#cfd4d9', stroke: C_EDGE, strokeWidth: 1.8 }));
        s.add(_text({ x: engX, y: engY + engH - 34, width: engW, align: 'center', fontSize: 17, fontStyle: 'bold', fill: '#1b1f23', text: 'MAN B&W   MC' }));
        // 6 个气缸
        for (let i = 0; i < 6; i++) {
            s.add(_rect({ x: engX + 16 + i * 74, y: engY + 60, width: 52, height: 96, fill: '#e8ebee', stroke: C_BOX_D, strokeWidth: 1.4 }));
            s.add(_circle({ x: engX + 42 + i * 74, y: engY + 108, radius: 16, fill: '#f4f6f8', stroke: C_BOX_D, strokeWidth: 1.2 }));
        }
        // 扫气箱/曲拐箱
        s.add(_rect({ x: engX + 8, y: engY + 26, width: engW - 16, height: 26, fill: '#b6bcc2', stroke: C_BOX_D, strokeWidth: 1 }));
        s.add(_text({ x: engX, y: engY + 32, width: engW, align: 'center', fontSize: 10.5, fill: '#2b3136', text: 'Scavenge air / Cylinder cover' }));

        // 凸轮轴 / 电动执行器
        this._box(s, 960, 430, 90, 70, 'Electric', 'Actuator');
        s.add(_line({ points: [1005, 500, 1005, 520], stroke: C_EDGE, strokeWidth: 2 }));

        // 机舱控制单元
        this._box(s, 300, 470, 70, 70, 'nn.', '');
        this._box(s, 385, 470, 76, 70, 'Slow Down', 'RAI16');
        this._box(s, 385, 560, 76, 70, 'Main Engine', 'Interface MEI');
        this._box(s, 300, 560, 70, 70, 'Engine', 'Safety ESU');

        // 调速器
        this._box(s, 1290, 470, 200, 80, 'Digital Governor', 'DGU');
        this._box(s, 1330, 560, 120, 60, 'Servo', 'Unit');
        this._box(s, 1290, 700, 200, 76, 'Dual RPM Units', '含超速保护系统');
        this._box(s, 1150, 700, 120, 76, 'RPM', 'Detectors');

        // 螺旋桨
        s.add(_line({ points: [940, 580, 1030, 580], stroke: C_EDGE, strokeWidth: 5 }));
        const px = 1100, py = 580;
        s.add(_circle({ x: px, y: py, radius: 12, fill: '#b6bcc2', stroke: C_EDGE, strokeWidth: 1.6 }));
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2;
            s.add(_line({
                points: [px, py, px + Math.cos(a) * 46, py + Math.sin(a) * 46],
                stroke: C_EDGE, strokeWidth: 7, lineCap: 'round',
            }));
        }

        // ── 双 CAN 总线 ──
        // 两翼 → 驾驶台
        this._dualCan(s, [320, 100, 400, 100, 400, 96, 620, 96]);
        this._dualCan(s, [1200, 100, 1120, 100, 1120, 96, 920, 96]);
        // 驾驶台 → 集控室
        this._dualCan(s, [770, 180, 770, 300]);
        // 集控室 → 机舱
        this._dualCan(s, [600, 376, 600, 470]);
        this._dualCan(s, [860, 376, 860, 430, 350, 430, 350, 470]);
        // 集控室 → 调速器
        this._dualCan(s, [1000, 376, 1000, 440, 1390, 440, 1390, 470]);
        // 机旁操纵台 → 机舱控制
        this._dualCan(s, [160, 470, 160, 440, 320, 440, 320, 470]);
        // DGU → 执行器
        this._dualCan(s, [1300, 500, 1050, 500]);
        // 转速检测 → 双测速单元
        this._dualCan(s, [1210, 738, 1290, 738]);
        // 主机 → 转速检测
        this._dualCan(s, [940, 660, 1150, 700]);

        // 图注
        s.add(_text({ x: 40, y: 736, width: 620, fontSize: 11.5, fill: '#3d464e', text: '图注：粗双线为 Dual CAN 现场总线；驾驶台 / 集控室 / 机旁三个操纵位置经总线共享主机操纵权。' }));
    }

    // ═══════════════════════════════════════════════════════
    //  动态
    // ═══════════════════════════════════════════════════════

    _createDynamic() {
        const d = this._dynamicGroup;

        // 各操纵单元的控制位置指示灯
        this._lamp = {};
        const addLamp = (key, x, y) => {
            const c = _circle({ x, y, radius: 8, fill: '#3a3f42' });
            d.add(c);
            this._lamp[key] = c;
        };
        addLamp('bw-port', 190, 148);
        addLamp('bw-stb', 1330, 148);
        addLamp('bridge', 770, 166);
        addLamp('ecr', 600, 362);
        addLamp('local', 160, 656);

        // DGU 伺服指示
        this._servoLamp = _circle({ x: 1490, y: 590, radius: 8, fill: '#3a3f42' });
        d.add(this._servoLamp);

        // 主机运行指示
        this._engLamp = _circle({ x: engLampX(), y: 470 + 12, radius: 7, fill: '#3a3f42' });
        d.add(this._engLamp);
        function engLampX() { return 470 + 24; }

        // 螺旋桨旋转标记
        this._propMark = new Konva.Group({ x: 1100, y: 580, rotation: 0, listening: false });
        this._propMark.add(new Konva.Arc({
            x: 0, y: 0, innerRadius: 52, outerRadius: 56, angle: 240, rotation: 30,
            fill: 'rgba(0,0,0,0)', stroke: '#2f7d32', strokeWidth: 3, listening: false,
        }));
        d.add(this._propMark);

        // 转速文本
        this._rpmTxt = _text({ x: 1150, y: 756, width: 120, align: 'center', fontSize: 14, fontStyle: 'bold', fill: '#1b4f1f', text: '68.0' });
        d.add(this._rpmTxt);
        this._rpmCmdTxt = _text({ x: 760, y: 352, width: 110, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#1b4f1f', text: '68' });
        d.add(this._rpmCmdTxt);
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

        mk('bw-port', 60, 40, 260, 120, () => this._setPos(CONTROL_POS.BRIDGE, '驾驶台（左翼）'));
        mk('bw-stb', 1200, 40, 260, 120, () => this._setPos(CONTROL_POS.BRIDGE, '驾驶台（右翼）'));
        mk('bridge-unit', 620, 30, 300, 150, () => this._setPos(CONTROL_POS.BRIDGE, '驾驶台'));
        mk('order-printer', 470, 40, 120, 70, () => this._tip('命令打印机：记录车钟命令与主机响应'));
        mk('cr-unit', 470, 246, 260, 130, () => this._setPos(CONTROL_POS.ECR, '集控室'));
        mk('cr-lever', 760, 246, 110, 130, () => { M.stepLever(-1, CONTROL_POS.ECR); this._tip(`集控室转速手柄：${M.lever.label}`); });
        mk('cr-indicator', 900, 246, 200, 130, () => this._tip('指示面板单元：显示主机转速、负荷与报警'));
        mk('local-panel', 40, 470, 240, 200, () => this._setPos(CONTROL_POS.LOCAL, '机旁'));
        mk('mei', 385, 560, 76, 70, () => this._tip('MEI 主机接口：采集主机状态并送入总线'));
        mk('esu', 300, 560, 70, 70, () => this._tip('ESU 主机安全单元：慢降 / 停车保护'));
        mk('rai', 385, 470, 76, 70, () => this._tip('Slow Down RAI16：远程模拟量输入模块'));
        mk('dgu', 1290, 470, 200, 80, () => this._tip('DGU 数字调速器：输出执行器位置指令'));
        mk('servo', 1330, 560, 120, 60, () => this._tip('Servo Unit 伺服单元：驱动燃油调节执行器'));
        mk('rpm-units', 1290, 700, 200, 76, () => this._tip('双测速单元（含超速保护）'));
        mk('actuator', 960, 430, 90, 70, () => this._tip('电动执行器：调节主机燃油量'));
        mk('engine', 470, 470, 470, 220, () => this._tip(`主机：${M.stateText}，${M.rpm.toFixed(1)} rpm，负荷 ${M.load.toFixed(1)} %`));
        mk('prop', 1046, 534, 108, 92, () => this._tip('螺旋桨：转速随主机变化'));
    }

    _setPos(pos, name) {
        const M = this.model;
        const ok = M.setControlPos(pos);
        this._tip(ok ? `控制位置切到${name}` : `控制位置已在${name}`);
    }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════

    tick() {
        const M = this.model;
        if (!M) return;

        const posOn = M.controlPos;
        this._lamp['bw-port'].fill(posOn === CONTROL_POS.BRIDGE ? C_GREEN : '#3a3f42');
        this._lamp['bw-stb'].fill(posOn === CONTROL_POS.BRIDGE ? C_GREEN : '#3a3f42');
        this._lamp['bridge'].fill(posOn === CONTROL_POS.BRIDGE ? C_GREEN : '#3a3f42');
        this._lamp['ecr'].fill(posOn === CONTROL_POS.ECR ? C_GREEN : '#3a3f42');
        this._lamp['local'].fill(posOn === CONTROL_POS.LOCAL ? C_GREEN : '#3a3f42');

        // 伺服 / 主机运行 / 螺旋桨
        this._servoLamp.fill(M.running ? C_GREEN : '#3a3f42');
        this._engLamp.fill(M.running ? C_GREEN : '#3a3f42');

        const spin = M.running ? (Math.abs(M.rpm) * 0.6) : 0;
        this._propMark.rotation((this._propMark.rotation() + spin * 0.02) % 360);
        this._propMark.visible(M.running);

        this._rpmTxt.text(M.rpm.toFixed(1));
        this._rpmCmdTxt.text(String(Math.round(M.rpmCmd)));

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
