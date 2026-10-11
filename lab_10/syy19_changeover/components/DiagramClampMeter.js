// 钳形电流表（简化外观 / Diagram 版）
//
// 电气模型完全继承 ClampMeter：type='clamp'、端口 com/v、参数 current/range/
// jawOpen/rampTime/mechanicalOffset、tick 跟随逻辑均与原型一致，求解器无需改动。
//
// 本类只重写"界面绘制"：删除右侧原理界面（铁心/整流/分流/表头），
// 仅保留左侧操作界面（钳口、旋钮、表盘、扳机、插孔），
// 整体面积约为原型的 2/3。

import { ClampMeter } from './ClampMeter.js';

export class DiagramClampMeter extends ClampMeter {
    // 简化尺寸：原左侧界面 190×480（整机 380×480 的左半）× √(2/3) ≈ 155×392
    static minWidth      = 130;
    static minHeight     = 300;
    static defaultWidth  = 155;
    static defaultHeight = 392;

    // ── 几何：操作界面占满整个组件，右侧原理界面取消 ──
    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX  = W;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 10 };

        const bodyCx = W * 0.50;

        // 钳口（顶部）
        const jawH    = H * 0.30;
        const jawW    = W * 0.65;
        const jawTopY = -H * 0.01;
        this._jaw = {
            cx: bodyCx, topY: jawTopY, w: jawW, h: jawH,
            outerR: jawW * 0.48, innerR: jawW * 0.25,
        };

        // 量程旋钮（中部）
        const knobCy = H * 0.48;
        this._knob = { cx: bodyCx, cy: knobCy, r: Math.min(W * 0.24, H * 0.09) };

        // 指针表盘（底部）
        const faceR = Math.min(W * 0.40, H * 0.16);
        this._face = { cx: bodyCx, cy: H * 0.80, r: faceR };

        // 机械调零螺丝
        this._mechZero = {
            x: bodyCx - faceR * 0.55,
            y: H * 0.80 + faceR * 0.30,
            r: Math.max(5, W * 0.028),
        };

        this._angleStart = 210;
        this._angleSweep = 120;

        // 扳机（钳口左侧）
        this._trigger = {
            x: bodyCx - jawW * 0.72,
            y: jawTopY + jawH * 0.55,
            w: W * 0.14, h: H * 0.08,
            rx: 5,
        };

        // 表笔插孔（底部，移向左侧操作界面左下区域）
        const jackY = H * 0.99;
        this._jackCOM = { x: bodyCx - W * 0.22, y: jackY };
        this._jackVA  = { x: bodyCx - W * 0.04, y: jackY };
        this._portCom = { x: this._jackCOM.x, y: H - 2 };
        this._portVA  = { x: this._jackVA.x,  y: H - 2 };

        // 右侧原理界面相关几何（已删除）
        this._core = this._wireLine = this._rectifier = this._shunt = this._meterHead = null;
    }

    // 去掉铁芯（钳口）处及其周边的整块背景；
    // 背景仅保留表体（覆盖量程切换旋钮与下方表头部分）
    _drawBodyPanel() { }

    // ── 仅绘制左侧界面（不绘制分割线与右侧原理界面）──
    _drawStaticParts() {
        this._drawBodyShell();
        this._drawJawStatic();
        this._drawFaceStatic();
        this._drawMechZeroScrew();
        this._drawTriggerStatic();
        this._drawKnobStatic();
        this._drawJackStatic();
    }

    // ── 动态节点：仅保留左侧界面相关 ──
    _createDynamicNodes() {
        this._createJawDynamic();
        this._createNeedle();
        this._createTriggerButton();
        this._createKnobDynamic();
        this._createCurrentDisplay();
        this._createMechZeroDynamic();
    }

    // ── 动态更新：去除右侧动圈指针/磁通部分 ──
    _updateDynamic() {
        const i = this._oilFault ? this._currentI * 0.55 : this._currentI;
        const offsetDeg = this._mechanicalOffset * this._angleSweep;

        // 指针
        this._needleAngle = this._currentToAngle(i) + offsetDeg;
        this._needleGroup.rotation(this._needleAngle);

        // 钳口动画
        const jawTarget = this._jawOpen ? 1 : 0;
        this._jawAngle += (jawTarget - this._jawAngle) * 0.15;
        const jawOpenDeg = this._jawAngle * 42;
        this._jawGroup.rotation(-jawOpenDeg);

        // 扳机
        const { y: ty, h: th } = this._trigger;
        this._triggerGroup.y(this._jawOpen ? ty + th * 0.08 : ty);
        this._triggerBody.fillLinearGradientColorStops(
            this._jawOpen
                ? [0, '#4a7a6a', 0.5, '#306050', 1, '#1e3830']
                : [0, '#5a6470', 0.5, '#3e4854', 1, '#28303a']
        );

        // 旋钮
        this._knobGroup.rotation(this._knobAngle);

        // 数字显示
        this._currentText.text(`${i.toFixed(1)} A`);

        // 机械调零螺丝槽线
        const mz = this._mechZero;
        const mzAngle = this._mechanicalOffset * 2400;
        const mzRad = mzAngle * Math.PI / 180;
        this._mechSlot.points([
            mz.x - mz.r * 0.6 * Math.cos(mzRad),
            mz.y - mz.r * 0.6 * Math.sin(mzRad),
            mz.x + mz.r * 0.6 * Math.cos(mzRad),
            mz.y + mz.r * 0.6 * Math.sin(mzRad),
        ]);
    }
}
