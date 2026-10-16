// 交流电流表（简化外观 / Diagram 版）
//
// 电气模型完全继承 ACAmmeter：type='ac_amp'、special='AC_AMMETER'、
// 端口 ap/an、参数 maxCurrent/frequency/rampTime/ctRatio、tick 中的 RMS
// 计算逻辑均与原型一致，求解器无需任何改动。
//
// 本类只重写"界面绘制"：删除右侧原理界面，仅保留左侧表盘操作界面，
// 两个接线柱贴在表盘圆周边缘（左下 / 右下对称）。

import { ACAmmeter } from './ACAmmeter.js';

export class DiagramACAmmeter extends ACAmmeter {
    // 简化尺寸：在 188×212 基础上再缩小到 4/5 面积 → 168×190
    static minWidth      = 140;
    static minHeight     = 150;
    static defaultWidth  = 168;
    static defaultHeight = 190;

    // ── 几何：操作界面占满整个组件，右侧原理界面取消 ──
    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX  = W;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        const fR = Math.min(W * 0.40, H * 0.36);
        this._face = { cx: W * 0.50, cy: H * 0.46, r: fR };

        this._angleStart = 165;
        this._angleSweep = 210;

        // 接线柱位于表盘外缘（外圈 r+8）的下端左右，间距减小；
        // 电气端口在其正下方组件底边，由竖直短线相连
        const outerR = fR + 8;
        const aL = 120 * Math.PI / 180;
        const aR = 60  * Math.PI / 180;
        this._termAp = { x: this._face.cx + outerR * Math.cos(aL), y: this._face.cy + outerR * Math.sin(aL) };
        this._termAn = { x: this._face.cx + outerR * Math.cos(aR), y: this._face.cy + outerR * Math.sin(aR) };
        this._portAp = { x: this._termAp.x, y: H - 2 };
        this._portAn = { x: this._termAn.x, y: H - 2 };

        // 右侧原理界面相关几何（已删除）
        this._coil = this._cavity = this._fixedVane = null;
        this._pivotX = 0; this._pivotY = 0;
    }

    // 去掉背景框：不再绘制面板底色
    _drawPanelBackground() { }

    _drawStaticParts() {
        this._drawFaceStatic();
        this._drawLeftTerminals();
    }

    // ── 接线柱：位于表盘外缘，经竖直短线连到下方电气端口 ──
    _drawLeftTerminals() {
        const tR = Math.max(7, this.width * 0.030);
        const defs = [
            { pos: this._termAp, color: '#c83020' },
            { pos: this._termAn, color: '#3068c0' },
        ];
        defs.forEach(td => {
            // 黄铜接线柱
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR,
                fillLinearGradientStartPoint: { x: -tR, y: -tR },
                fillLinearGradientEndPoint:   { x:  tR, y:  tR },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR * 0.40, fill: '#383028',
            }));
            // 竖直向下的短线 → 电气端口
            this._staticGroup.add(new Konva.Line({
                points: [td.pos.x, td.pos.y + tR, td.pos.x, this.height - 2],
                stroke: td.color, strokeWidth: 2,
            }));
        });
    }

    // ── 动态节点：仅指针与数字读数 ──
    _createDynamicNodes() {
        this._createNeedle();
        this._createCurrentDisplay();
    }

    _updateDynamic() {
        const i = this._currentI;

        // 指针限位在满量程（_currentToAngle 内部 clamp），超量程不再偏转
        this._needleAngle = this._currentToAngle(i);
        this._needleGroup.rotation(this._needleAngle);

        // 液晶显示真实测量值：即使超量程也照常显示（超量程红色警示）
        const over = i > this.maxCurrent;
        const low  = i < this.maxCurrent * 0.20;
        this._currText.text(`${i.toFixed(2)} A`);
        this._currText.fill(over ? '#d02020' : (low ? '#e08030' : '#40c870'));
    }
}
