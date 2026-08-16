/**
 * Multimeter.js
 * 基于 Konva.js 的万用表组件（注释版）
 *
 * 说明:
 * - 该组件继承自 `BaseComponent`，在画布上以 Group 的局部坐标绘制一个便携式数字万用表。
 * - 支持常见档位：OFF, 直流电压(多量程), 交流电压, 电阻/通断/二极管档, 毫安档, 电容档等。
 * - 采用 Konva 的静态/动态/交互分组策略（`_staticGroup`、`_dynamicGroup`、`_interactGroup`），并使用 `cache='fixed'` 提高渲染性能。
 * - 逻辑以 `this.mode` 驱动显示与蜂鸣器逻辑；测量值通过 `update(val)` 接收并做节流显示。
 *
 * 单位与映射规则（实现说明）:
 * - 直流电压档: 内部 `this.value` 以伏特 (V) 表示，`DCVmv` 会乘以1000显示为 mV。
 * - 直流电流档: 内部以安培 (A) 表示，显示时根据大小切换 uA/mA/A 单位。
 * - 电阻档: 假设外部提供的值以欧姆 (Ω) 为单位；某些档位会以 kΩ 显示。
 * - 二极管/蜂鸣档: 通过阈值判断正向压降或导通（模拟蜂鸣与显示发光）。
 * - 溢出 (overload): 超出量程时显示 `O.L`。
 *
 * 注意:
 * - 注释仅为文档说明，不修改原有行为。
 */
import { BaseComponent } from './BaseComponent.js';

export class Multimeter extends BaseComponent {
    /**
     * 构造函数
     * @param {object} config - 组件配置（宽高等）
     * @param {object} sys - 系统上下文，包含 stage、请求重绘等方法
     *
     * 构造时：
     * - 初始化绘图分组 `_initGroups()`（在 BaseComponent 中定义）
     * - 设置缩放、尺寸、默认状态与端口（mA, COM, V）
     */
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();
        this.scale = 1;

        // 1. 内部状态
        this.mode = 'OFF';       // 当前档位: OFF, DCV, ACV, RES, DIODE, DCMA, 
        this.type = 'multimeter';
        this.cache = 'fixed'; // 用于静态缓存的特殊标识

        this.value = 1000000;        // 输入的物理值
        this.displayValue = "O.L"; // 屏幕显示字符串

        this.width = (config.width || 240) * this.scale;
        this.height = (config.height || 400) * this.scale;

        this._createUI();
        // 更新节流参数（ms）——仅真正更新显示与蜂鸣的频率
        this._displayThrottle = 200; // ms
        this._lastUpdateAt = 0;
        this._pendingValue = null;
        this._pendingTimer = null;
        // 底部插孔（物理端口）说明：
        // - 左：`ma`，用于毫安档/电流测量（红）
        // - 中：`com`，公共端（黑）
        // - 右：`v`，用于电压/电阻/二极管等测量（红）
        const spacing = Math.floor(this.width / 3.3333333); // approx 90 for width=300
        const startX = this.width / 2 - spacing;
        this.addPort(startX, this.height - 25, 'ma', 'wire', 'p');
        this.addPort(startX + spacing, this.height - 25, 'com', 'wire');
        this.addPort(startX + 2 * spacing, this.height - 25, 'v', 'wire', 'p');
    }

    /**
     * 构建万用表外观
     */
    /**
     * 创建并布局所有静态/交互界面元素
     * - 在 `_staticGroup` 放置不随频繁更新改变的图形（外壳、标签、插孔）
     * - 在 `_interactGroup` 放置需要响应交互或更新的元素（LCD、旋钮指针）
     */
    _createUI() {
        // 使用 group 的局部坐标 (0,0) 作为万用表左上角
        const cx = this.width / 2;
        const bodyWidth = this.width;
        const bodyHeight = this.height;

        // --- 外壳 (青色边框 + 深灰面板) ---
        const body = new Konva.Rect({
            x: 0, y: 0,
            width: bodyWidth, height: bodyHeight,
            fill: '#444', stroke: '#00ced1', strokeWidth: 12 * this.scale,
            cornerRadius: 40 * this.scale, shadowBlur: 20 * this.scale
        });

        // 先将外壳加入 group，保证为底层
        this._staticGroup.add(body);

        // --- 液晶屏区域 ---
        const lcdWidth = Math.min(220 * this.scale, Math.max(200 * this.scale, Math.floor(this.width - 80 * this.scale)));
        const lcdHeight = 90 * this.scale;
        const lcdX = Math.floor((this.width - lcdWidth) / 2);
        const lcdY = 40 * this.scale;

        const lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY,
            width: lcdWidth, height: lcdHeight,
            fill: '#c5ccb7', stroke: '#222', strokeWidth: 2 * this.scale, cornerRadius: 5 * this.scale
        });

        this.lcdText = new Konva.Text({
            x: lcdX + 10 * this.scale, y: lcdY + 15 * this.scale,
            text: ' ', fontSize: Math.min(60 * this.scale, Math.floor(this.width / 6)), fontFamily: 'monospace',
            fill: '#222', width: lcdWidth - 20 * this.scale, align: 'right', fontStyle: 'bold'
        });

        this.lcdUnit = new Konva.Text({
            x: lcdX + lcdWidth - 30 * this.scale, y: lcdY + lcdHeight - 30 * this.scale,
            text: ' ', fontSize: 20 * this.scale, fill: '#222'
        });

        this.lcdMode = new Konva.Text({
            x: lcdX + 10 * this.scale, y: lcdY + lcdHeight - 25 * this.scale,
            text: ' ', fontSize: 14 * this.scale, fill: '#e3142f'
        });

        // --- 挡位旋钮 ---
        const knobY = Math.floor(this.height * 0.63);
        this.knobGroup = new Konva.Group({ x: cx, y: knobY });
        const knobRadius = Math.min(80 * this.scale, Math.floor(this.width * 0.26));
        const knobCircle = new Konva.Circle({
            radius: knobRadius, fill: '#333', stroke: '#111', strokeWidth: 5 * this.scale,
            shadowBlur: 5 * this.scale
        });

        //电阻档标志
        const resArc = new Konva.Arc({
            InnerRadius: knobRadius - 3 * this.scale, outerRadius: knobRadius, angle: 90, rotation: -60, fill: '#17e760', stroke: '#08df2f', strokeWidth: 1 * this.scale,
        });

        //交流电压档标志
        const acArc = new Konva.Arc({
            InnerRadius: knobRadius - 3 * this.scale, outerRadius: knobRadius, angle: 30, rotation: 120, fill: '#f17c08', stroke: '#ec9819', strokeWidth: 1 * this.scale,
        });
        //直流电压档标志
        const dcArc = new Konva.Arc({
            InnerRadius: knobRadius - 3 * this.scale, outerRadius: knobRadius, angle: 60, rotation: 180, fill: '#f10808', stroke: '#f00505', strokeWidth: 1 * this.scale,
        });
        this.pointer = new Konva.Line({
            points: [0, -10 * this.scale, 0, -Math.floor(knobRadius * 0.9)],
            stroke: '#999', strokeWidth: Math.max(10 * this.scale, Math.floor(knobRadius * 0.1)), lineCap: 'round'
        });

        this.knobGroup.add(knobCircle, this.pointer, resArc, acArc, dcArc);
        // 初始指针指向 -90 度（左侧 OFF）
        this.pointer.rotation(0);

        // 将其他主要部件加入 group（在 body 之上）
        this._interactGroup.add(lcdBg, this.lcdText, this.lcdUnit, this.lcdMode, this.knobGroup);

        // --- 挡位文字标注 ---
        this._drawScaleLabels(cx, knobY);

        // --- 插孔区域 ---
        const jacksY = Math.floor(this.height - 25);
        this._drawJacks(cx, jacksY);

        try {
            if (this.group && typeof this.group.clearCache === 'function') {
                this.group.clearCache();
                if (typeof this.group.cache === 'function') this.group.cache();
            }
        } catch (e) { console.warn('cache refresh failed', e); }

        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();

        // 绑定旋钮交互：鼠标按下或触摸开始时旋转切换量程
        this.knobGroup.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._rotateKnob(e); if (this.sys.onComponentStateChange)
                this.sys.onComponentStateChange(this);
        });
        // 2. 关键：明确阻止旋钮上的双击事件冒泡到 group
        this.knobGroup.on('dblclick', (e) => {
            e.cancelBubble = true; // 阻止双击信号传给父级，防止弹出配置框
        });
    }

    /**
     * 绘制旋钮周围的刻度文字与刻度点
     * 参数 `scales` 定义了每个刻度对应的文本与角度（用于 `_updateModeByAngle`/`_updateAngleByMode` 的映射）
     */
    _drawScaleLabels(cx, cy) {
        const scales = [
            { label: 'OFF', angle: 0, mode: 'OFF' },
            { label: '200mv', angle: -30, mode: 'DCVmv' },
            { label: '20V', angle: -60, mode: 'DCV20' },
            { label: '200V', angle: -90, mode: 'DCV200' },
            { label: '~200V', angle: -120, mode: 'ACV200' },
            { label: '~500V', angle: -150, mode: 'ACV500' },
            { label: '▶|-))', angle: 30, mode: 'DIODE' },
            { label: '200Ω', angle: 60, mode: 'RES200' },
            { label: '2kΩ', angle: 90, mode: 'RES2k' },
            { label: '200kΩ', angle: 120, mode: 'RES200k' },
            { label: 'mA', angle: 150, mode: 'MA' },
            { label: 'uF', angle: 180, mode: 'C' }
        ];

        const radius = Math.min(110 * this.scale, Math.max(40 * this.scale, Math.floor(this.width / 3)));
        const knobRadius = Math.min(80 * this.scale, Math.floor(this.width * 0.26));
        scales.forEach(s => {
            const rad = (s.angle - 90) * (Math.PI / 180);
            const x = cx + Math.cos(rad) * radius;
            const y = cy + Math.sin(rad) * radius;
            const markx = cx + Math.cos(rad) * knobRadius;
            const marky = cy + Math.sin(rad) * knobRadius;
            const mark = new Konva.Circle({
                x: markx, y: marky, radius: 3 * this.scale, fill: '#0e5ae7', stroke: '#1165eb', strokeWidth: 1 * this.scale,
            });

            const text = new Konva.Text({
                x: x - 20 * this.scale, y: y - 6 * this.scale,
                text: s.label, fontSize: 12 * this.scale, fill: '#fff', width: 40 * this.scale, align: 'center'
            });
            this._staticGroup.add(text, mark);
        });
    }

    /**
     * 绘制底部插孔视觉与文字标签
     * 仅作视觉效果，实际电气逻辑由系统端口连接处理。
     */
    _drawJacks(cx, y) {
        const jackLabels = ['mA', 'COM', 'VΩ▶|'];
        const colors = ['#c00', '#000', '#c00'];

        const spacing = Math.floor(this.width / 3.3333333); // approx 90 for width=300
        const startX = cx - spacing;
        const jackRadius = Math.max(8 * this.scale, Math.min(20 * this.scale, Math.floor(this.width * 0.06)));

        jackLabels.forEach((l, i) => {
            const x = startX + i * spacing;
            const jack = new Konva.Circle({
                x: x, y: y, radius: jackRadius, fill: colors[i], stroke: '#111', strokeWidth: 3 * this.scale
            });
            const inner = new Konva.Circle({
                x: x, y: y, radius: Math.floor(jackRadius * 0.6), fill: '#222', stroke: '#333', strokeWidth: 3 * this.scale
            });
            const label = new Konva.Text({
                x: x - Math.floor(jackRadius * 3), y: y - (jackRadius + 20 * this.scale), text: l, fontSize: 12 * this.scale, fill: '#fff', width: Math.floor(jackRadius * 6), align: 'center'
            });
            this._staticGroup.add(jack, inner, label);

        });
    }

    /**
     * 逻辑：旋转旋钮并切换模式
     */
    /**
     * 旋转旋钮并切换 `this.mode`
     * - 以点击位置决定方向，每次步进 30°。
     * - rotation 经过归一化后交由 `_updateModeByAngle` 映射到具体量程字符串。
     */
    _rotateKnob(e) {
        // 点击决定旋转方向：点击在指针顺时针方向 -> 顺时针转动；点击在逆时针方向 -> 逆时针转动
        // 步进 30°，限制在 [-90, 90]
        const stage = this.sys.stage;
        if (!stage) return;
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const knobAbs = this.knobGroup.getAbsolutePosition();
        const dx = pointerPos.x - knobAbs.x;
        const dy = pointerPos.y - knobAbs.y;

        const clickAngle = Math.atan2(dy, dx) * 180 / Math.PI; // 相对于 +x 轴
        const desiredRotation = clickAngle + 90; // 将 +x 轴角度转换为 rotation 空间（rotation=0 指向上）

        const currentRotation = this.pointer.rotation();

        let delta = desiredRotation - currentRotation;
        // 归一化到 (-180,180]
        delta = ((delta + 540) % 360) - 180;

        const step = 30;
        const minRot = -3600;
        const maxRot = 3600;

        let newRotation = currentRotation;
        if (delta > 1) {
            newRotation = Math.min(maxRot, currentRotation + step);
        } else if (delta < -1) {
            newRotation = Math.max(minRot, currentRotation - step);
        } else {
            return; // 点击在指针方向附近，不变
        }

        if (Math.abs(newRotation - currentRotation) < 1e-6) return;

        this.pointer.rotation(newRotation);
        this._updateModeByAngle(newRotation);

        this._refreshCache();
    }

    /**
     * 根据旋转角度映射到档位标识（`this.mode`）
     * 角度映射规则与 `_drawScaleLabels` 中 `scales` 保持一致。
     */
    _updateModeByAngle(angle) {
        // 归一化角度到 0-360 之间
        const normalizedAngle = (angle % 360 + 360) % 360;

        /**
            { label: 'OFF', angle: 0, mode: 'OFF' },
            { label: '200mv', angle: -30, mode: 'DCVmv' },
            { label: '20V', angle: -60, mode: 'DCV20' },
            { label: '200V', angle: -90, mode: 'DCV200' },
            { label: '~200V', angle: -120, mode: 'ACV200' },
            { label: '~500V', angle: -150, mode: 'ACV500' },
            { label: '▶|', angle: 30, mode: 'DIODE' },
            { label: '200Ω', angle: 60, mode: 'RES200' },
            { label: '2kΩ', angle: 90, mode: 'RES2k' },
            { label: '200kΩ', angle: 120, mode: 'RES200k' },
            { label: 'mA', angle: 150, mode: 'MA' },
            { label: 'uF', angle: 180, mode: 'C' }
         */

        switch (true) {

            case (normalizedAngle >= 350 || normalizedAngle < 10):
                this.mode = 'OFF';
                break;
            case (normalizedAngle >= 20 && normalizedAngle < 40):
                this.mode = 'DIODE';
                break;
            case (normalizedAngle >= 50 && normalizedAngle < 70):
                this.mode = 'RES200';
                break;
            case (normalizedAngle >= 80 && normalizedAngle < 100):
                this.mode = 'RES2k';
                break;
            case (normalizedAngle >= 110 && normalizedAngle < 130):
                this.mode = 'RES200k';
                break;
            case (normalizedAngle >= 140 && normalizedAngle < 160):
                this.mode = 'MA';
                break;
            case (normalizedAngle >= 170 && normalizedAngle < 190):
                this.mode = 'C';
                break;
            case (normalizedAngle >= 200 && normalizedAngle < 220):
                this.mode = 'ACV500';
                break;
            case (normalizedAngle >= 230 && normalizedAngle < 250):
                this.mode = 'ACV200';
                break;
            case (normalizedAngle >= 260 && normalizedAngle < 280):
                this.mode = 'DCV200';
                break;
            case (normalizedAngle >= 290 && normalizedAngle < 310):
                this.mode = 'DCV20';
                break;
            case (normalizedAngle >= 320 && normalizedAngle < 340):
                this.mode = 'DCVmv';
                break;
            default:
                this.mode = 'OFF';
        }


    }
    /**
     * 根据当前 `this.mode` 设置旋钮指针角度（用于程序改变档位时同步 UI）
     */
    _updateAngleByMode() {
        /**
    { label: 'OFF', angle: 0, mode: 'OFF' },
    { label: '200mv', angle: -30, mode: 'DCVmv' },
    { label: '20V', angle: -60, mode: 'DCV20' },
    { label: '200V', angle: -90, mode: 'DCV200' },
    { label: '~200V', angle: -120, mode: 'ACV200' },
    { label: '~500V', angle: -150, mode: 'ACV500' },
    { label: '▶|', angle: 30, mode: 'DIODE' },
    { label: '200Ω', angle: 60, mode: 'RES200' },
    { label: '2kΩ', angle: 90, mode: 'RES2k' },
    { label: '200kΩ', angle: 120, mode: 'RES200k' },
    { label: 'mA', angle: 150, mode: 'MA' },
    { label: 'uF', angle: 180, mode: 'C' }
 */
        switch (this.mode) {
            case 'DCVmv':
                this.pointer.rotation(-30);
                break;
            case 'DCV20':
                this.pointer.rotation(-60);
                break;
            case 'DCV200':
                this.pointer.rotation(-90);
                break;
            case 'ACV200':
                this.pointer.rotation(-120);
                break;
            case 'ACV500':
                this.pointer.rotation(-150);
                break;
            case 'OFF':
                this.pointer.rotation(0);
                break;
            // --- 电阻与通断档 ---
            case 'DIODE': // 蜂鸣/二极管档
                this.pointer.rotation(30);
                break;
            case 'RES200':
                this.pointer.rotation(60);
                break;
            case 'RES2k':
                this.pointer.rotation(90);
                break;
            case 'RES200k':
                this.pointer.rotation(120);
                break;

            // --- 电流与电容档 ---
            case 'MA':
                this.pointer.rotation(150);
                break;
            case 'C':
                this.pointer.rotation(180);
                break;

            default:
                break;
        }
        this._refreshCache();
    }
    /**
 * 停止蜂鸣器声音
 * 采用安全的状态检查，确保振荡器被彻底销毁
 */
    // MultiMeter 类内部方法：播放/停止蜂鸣并安全清理音频节点与定时器
    /**
     * 控制蜂鸣器（短促音）并安全清理 AudioNode
     * - 使用 Web Audio API 创建方波振荡器并在短时后释放资源
     * - 多次触发会先清理已有振荡器以避免资源泄露
     */
    triggerBeep(isBeeping) {
        if (!this.lcdText) return;

        if (isBeeping) {
            if (this.isBeepingNow) return;
            this.isBeepingNow = true;
            this.lcdText.fill('#f1c40f'); // 数值变黄模拟发光

            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => { });
            }

            // 如果已有未清理的振荡器，先清理
            if (this._osc) {
                try { this._osc.stop(); } catch (e) { }
                try { this._osc.disconnect(); } catch (e) { }
                this._osc = null;
            }
            if (this._gain) {
                try { this._gain.disconnect(); } catch (e) { }
                this._gain = null;
            }
            if (this._beepStopTimer) {
                clearTimeout(this._beepStopTimer);
                this._beepStopTimer = null;
            }

            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2500, this.audioCtx.currentTime);
            gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            try { osc.start(); } catch (e) { }

            this._osc = osc;
            this._gain = gain;

            // 短促蜂鸣（200ms），并在结束后清理资源与恢复颜色
            this._beepStopTimer = setTimeout(() => {
                if (this._osc) {
                    try { this._osc.stop(); } catch (e) { }
                    try { this._osc.disconnect(); } catch (e) { }
                    this._osc = null;
                }
                if (this._gain) {
                    try { this._gain.disconnect(); } catch (e) { }
                    this._gain = null;
                }
                this.isBeepingNow = false;
                this._beepStopTimer = null;
                // 恢复为默认颜色（update 可能再次设置颜色）
                try { this.lcdText.fill('#222'); } catch (e) { }
            }, 2000);
        } else {
            // 立即停止蜂鸣并清理
            if (this._beepStopTimer) {
                clearTimeout(this._beepStopTimer);
                this._beepStopTimer = null;
            }
            if (this._osc) {
                try { this._osc.stop(); } catch (e) { }
                try { this._osc.disconnect(); } catch (e) { }
                this._osc = null;
            }
            if (this._gain) {
                try { this._gain.disconnect(); } catch (e) { }
                this._gain = null;
            }
            this.isBeepingNow = false;
            try { this.lcdText.fill('#222'); } catch (e) { }
        }
    }

    /**
     * 接收来自外部的测量值并更新显示（节流处理）
     * @param {number} val - 外部传入的物理量（内部约定：电压以 V，电流以 A，电阻以 Ω）
     *
     * 显示与量程规则：
     * - 根据 `this.mode` 决定单位、精度与是否溢出（`O.L`）。
     * - 为减轻主线程压力，采用 `_displayThrottle` 合并快速到来的多次更新。
     */
    update(val) {
        this.value = val;

        const now = performance.now();
        const elapsed = now - (this._lastUpdateAt || 0);
        // 若离上次实际屏幕更新未满节流间隔，则延迟合并更新
        if (elapsed < this._displayThrottle) {
            this._pendingValue = val;
            if (!this._pendingTimer) {
                const wait = Math.max(1, this._displayThrottle - elapsed);
                this._pendingTimer = setTimeout(() => {
                    this._pendingTimer = null;
                    // 强制立即应用 pending 值
                    try { this.update(this._pendingValue); } catch (e) { }
                }, wait);
            }
            return; // 跳过实际 DOM/Konva 更新以减轻主线程负担
        }
        // 记录本次实际更新时间
        this._lastUpdateAt = now;
        this._pendingValue = null;

        // 1. 关机状态处理：OFF 档清空显示并关闭蜂鸣器
        if (this.mode === 'OFF') {
            this.lcdText.text('');
            this.lcdMode.text('');
            this.lcdUnit.text('');
            this.triggerBeep(false); // 关机必须关声音
            this._refreshCache();
            return;
        }

        let display = this.value;
        let unit = '';
        let prefix = 'DC';
        let precision = 3;
        let isOverload = false;

        // 2. 根据 12 种模式处理量程、单位、精度与过载判定
        switch (this.mode) {
            // --- 直流电压档 ---
            // 直流毫伏档：内部值以 V 表示，显示时乘以 1000 => mV
            case 'DCVmv':
                unit = 'mV';
                prefix = 'DC';
                precision = 1;
                display = display * 1000;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'DCV20':
                unit = 'V';
                prefix = 'DC';
                precision = 2; // 19.99V
                if (Math.abs(display) > 20) isOverload = true;
                break;
            case 'DCV200':
                unit = 'V';
                prefix = 'DC';
                precision = 1; // 199.9V
                if (Math.abs(display) > 200) isOverload = true;
                break;

            // --- 交流电压档 ---
            case 'ACV200':
                unit = 'V';
                prefix = 'AC';
                precision = 1;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'ACV500':
                unit = 'V';
                prefix = 'AC';
                precision = 0; // 高压档通常不留小数
                if (Math.abs(display) > 500) isOverload = true;
                break;

            // --- 电阻与通断档 ---
            case 'DIODE': // 蜂鸣/二极管档
                unit = 'Ω';
                prefix = '▶|·))';
                precision = 1;
                // 蜂鸣逻辑：阻值小于 50 欧姆
                if (display === 0.6868 || display === 0.6767) { // 二极管正向压降典型值，模拟发光
                    unit = 'V';
                    precision = 2;
                } else if (display < 0.6) {
                    this.lcdText.fill('#f1c40f');
                    this.triggerBeep(true);
                } else {
                    this.lcdText.fill('#222');
                    this.triggerBeep(false);
                }
                if (display > 50) isOverload = true; // 
                break;
            case 'RES200':
                unit = 'Ω';
                prefix = '';
                precision = 2;
                if (display > 200) isOverload = true;
                break;
            case 'RES2k':
                unit = 'kΩ';
                prefix = '';
                display = display / 1000;
                precision = 3; // 1.999 kΩ
                if (display > 2) isOverload = true;
                break;
            case 'RES200k':
                unit = 'kΩ';
                prefix = '';
                display = display / 1000;
                precision = 1; // 199.9 kΩ
                if (display > 200) isOverload = true;
                break;

            // --- 电流与电容档 ---
            case 'MA':
                // 电流档：根据数值自动选择 uA/mA/A 单位显示（内部以 A 为基准）
                if (Math.abs(display) < 0.1) {
                    unit = 'uA';
                    display = display * 1000; // A -> mA (此处逻辑为示意，保持原实现)
                }
                else if (Math.abs(display) > 100) {
                    unit = 'A';
                    display = display / 1000;
                } else {
                    unit = 'mA';
                    display = display;
                }
                prefix = 'DC';
                precision = 2;
                if (display > 100) isOverload = true;
                break;
            case 'C':
                unit = 'uF';
                prefix = 'CAP';
                precision = 2;
                if (display > 200) isOverload = true; // 假设最大 200uF
                break;

            default:
                break;

        }

        // 3. 渲染显示内容：超出量程显示 O.L，否则格式化为固定小数位
        if (isOverload) {
            this.lcdText.text('O.L'); // 工业标准溢出显示
        } else {
            this.lcdText.text(display.toFixed(precision));
        }

        this.lcdUnit.text(unit);
        this.lcdMode.text(prefix);

        // 4. 强制重绘
        this._refreshCache();
    }


    destroy() {
        super.destroy?.();
    }
}
