import { MarineHVGenerator } from './MarineHVGenerator.js';

/**
 * SimpleHVGenerator 简化版高压发电机
 *
 * 只保留左侧操作界面（LCD / 本地遥控转换开关 / 起动停止带灯按钮 /
 * 调速旋钮 / 励磁开关），电气接口仅 4 个：
 *   - 顶部：u / v / w —— 三相输出
 *   - 底部：n —— 中性点
 * 其它接口（灭磁 mc_a/mc_b、遥控起动/停止/调速、CT/PT 测量）全部删除。
 *
 * 电气模型：type='source_3p'（继承 SyncGenerator3P，复用求解器三相电源 stamp）。
 * 励磁开关 OFF 时等同灭磁（定子无输出）。
 *
 * 宽度收缩至操作台宽度，右侧本体图形通过 group.clip 裁剪隐藏。
 */
export class SimpleHVGenerator extends MarineHVGenerator {

    // ─────────────────────────── 几何（操作台 + 顶部引线区） ───────────────────────────
    _recalcGeometry() {
        super._recalcGeometry();
        this.width  = 170;
        this.height = 264;

        // 三相输出（顶部）+ 中性点（底部）：操作台顶部引线区
        this._portX = { u: 42, v: 80, w: 118, n: 80 };

        // LCD 下移，让出顶部三相引线区（y=0~20）
        this._ctrl.lcd = { x: 3, y: 24, w: 152, h: 58 };

        // 裁剪到操作台宽度：隐藏右侧本体 / CT / PT / 遥控接口图形
        this.group.clip({ x: 0, y: 0, width: this.width, height: this.height });
    }

    // ─────────────────────────── 静态绘制（仅操作台 + 引线） ───────────────────────────
    _drawStaticParts() {
        const W = this.width, H = this.height;

        // 操作台面板 + 顶部引线区背景条
        this._staticGroup.add(new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3 }));
        this._staticGroup.add(new Konva.Rect({ x: 0, y: 0, width: W, height: 20, fill: '#dfe7ee', stroke: '#5a6a75', strokeWidth: 0.5 }));

        // LCD 背景
        const lcd = this._ctrl.lcd;
        this._staticGroup.add(new Konva.Rect({ x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h, fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1 }));

        // 控制方式开关底座
        this._drawSwitchBase();

        // 起动/停止按钮底座与标签
        [[this._ctrl.start], [this._ctrl.stop]].forEach(([c]) => {
            this._staticGroup.add(new Konva.Rect({ x: c.x - 2, y: c.y - 2, width: c.w + 4, height: c.h + 4, fill: '#cdd8e0', cornerRadius: 4 }));
        });
        this._staticGroup.add(new Konva.Text({ x: this._ctrl.start.x, y: this._ctrl.start.y + this._ctrl.start.h + 2, width: this._ctrl.start.w, text: '起动', fontSize: 11, fill: '#2e7d32', align: 'center', fontStyle: 'bold' }));
        this._staticGroup.add(new Konva.Text({ x: this._ctrl.stop.x, y: this._ctrl.stop.y + this._ctrl.stop.h + 2, width: this._ctrl.stop.w, text: '停止', fontSize: 11, fill: '#b71c1c', align: 'center', fontStyle: 'bold' }));

        // 调速旋钮刻度盘
        const knob = this._ctrl.knob;
        this._staticGroup.add(new Konva.Circle({ x: knob.x, y: knob.y, radius: knob.r + 4, fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: knob.x - 40, y: knob.y + knob.r + 4, width: 80, text: '减速  ←  加速', fontSize: 11, fill: '#333', align: 'center' }));

        // 励磁开关底盘
        const exc = this._ctrl.exc;
        this._staticGroup.add(new Konva.Circle({ x: exc.x, y: exc.y, radius: exc.r + 4, fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: exc.x - 28, y: exc.y - exc.r - 16, width: 56, text: 'OFF      ON', fontSize: 10, fill: '#333', align: 'center' }));
        this._staticGroup.add(new Konva.Text({ x: exc.x - 28, y: exc.y + exc.r + 2, width: 56, text: '励磁', fontSize: 11, fill: '#333', align: 'center' }));

        // ── 顶部三相电气接口（u红 / v绿 / w蓝）──
        const cols = ['#e02020', '#20a030', '#2a60d0'];
        const names = ['U', 'V', 'W'];
        ['u', 'v', 'w'].forEach((ph, i) => {
            const x = this._portX[ph];
            this._staticGroup.add(new Konva.Text({ x: x - 14, y: 14, width: 28, text: names[i], fontSize: 11, fontStyle: 'bold', fill: cols[i], align: 'center' }));
        });

        // ── 底部中性点电气接口（n）──
        const nx = this._portX.n;
        this._staticGroup.add(new Konva.Text({ x: nx - 7, y: H - 20, width: 14, text: 'N', fontSize: 11, fontStyle: 'bold', fill: '#44505a', align: 'center' }));
    }

    // ─────────────────────────── 端口（仅 u/v/w/n） ───────────────────────────
    _addPorts() {
        const p = this._portX;
        // 端口圆（半径 6）下移/上移 6px，避免圆心在边界被裁剪成半圆
        this.addPort(p.u, 6, 'u', 'wire', 'p');
        this.addPort(p.v, 6, 'v', 'wire', 'p');
        this.addPort(p.w, 6, 'w', 'wire', 'p');
        this.addPort(p.n, this.height - 6, 'n', 'wire');
    }

    destroy() { super.destroy?.(); }
}