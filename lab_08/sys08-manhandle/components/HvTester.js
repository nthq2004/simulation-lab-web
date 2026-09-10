import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * HvTester 高压验电器
 *
 * 竖直结构（自上而下）：
 *   - 接触头（金属尖端）：与带电端口接触时发出声光报警
 *   - 声光报警体：红色报警灯（闪烁）+ 测试按钮（按压自检）
 *   - 连接杆：可伸长 / 缩短（点击切换）
 *   - 绝缘手柄：手持部位
 *
 * 交互：
 *   - 点击测试按钮 → 声光报警 2s（自检）
 *   - 点击连接杆区域 → 伸长 / 缩短切换
 *   - 接触头靠近带电端口（|电压| > 5V）→ 持续声光报警
 */
export class HvTester extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = 40;
        this.height = 213;
        this.type  = 'hv_tester';
        this.cache = 'fixed';
        this._initGroups();
        this._init();
        this._extended = true;      // 连接杆：默认伸长
        this._testT = 0;            // 测试按钮自检剩余时长 s
        this._alarmOn = false;      // 声光报警激活
        this._live = false;         // 接触头是否接触带电端口
        this._flashT = 0;           // 报警灯闪烁计时
        this._audioCtx = null;
        this._osc = null;
        this._gain = null;
        this.config = {};
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        const cx = 0;
        // 接触头：金属尖端（三角）+ 金属杆
        s.add(new Konva.Line({ points: [-4, 8, 0, 0, 4, 8], stroke: '#c9c2b2', strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round' }));
        s.add(new Konva.Rect({ x: -2, y: 8, width: 4, height: 8, fill: '#c9c2b2' }));
        this._tip = new Konva.Circle({ x: 0, y: 0, radius: 2, fill: '#c9c2b2' });
        s.add(this._tip);
        // 声光报警体：盒（16 ~ 68）
        s.add(new Konva.Rect({ x: -22, y: 16, width: 44, height: 52, fill: '#eef1f4', stroke: '#2c3a45', strokeWidth: 1.5, cornerRadius: 3 }));
        s.add(new Konva.Text({ x: -25, y: 20, width: 50, text: '声光报警', fontSize: 11, fill: '#333', align: 'center', listening: false }));
       
        // 测试按钮（黄色矩形，报警体下部）
        s.add(new Konva.Rect({ x: -12, y: 53, width: 24, height: 12, fill: '#ffd000', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 2 }));
        s.add(new Konva.Text({ x: -25, y: 40, width: 50, text: '测试', fontSize: 8, fill: '#555', align: 'center', listening: false }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        // 报警灯（红色，动态闪烁）
        this._alarmLed = new Konva.Circle({ x: 0, y: 42, radius: 7, fill: '#7a1515', stroke: '#2c3a45', strokeWidth: 1 });
        d.add(this._alarmLed);
        // 连接杆（伸缩线）
        this._poleLine = new Konva.Line({ points: [0, 68, 0, 158], stroke: '#d0b020', strokeWidth: 6, lineCap: 'round' });
        d.add(this._poleLine);
        // 绝缘手柄（位置随伸缩）
        this._handle = new Konva.Group({ y: 158 });
        this._handle.add(new Konva.Rect({ x: -14, y: 0, width: 28, height: 55, fill: '#3a3f47', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 6 }));
        this._handle.add(new Konva.Line({ points: [-8, 8, 8, 8], stroke: '#5a5f67', strokeWidth: 2 }));
        this._handle.add(new Konva.Text({ x: -30, y: 60, width: 60, text: '高压验电器', fontSize: 12, fill: '#f70808', align: 'center', listening: false }));
        this._handle.add(new Konva.Text({ x: -20, y: 30, width: 40, text: 'HV', fontSize: 7, fill: '#999', align: 'center', listening: false }));
        d.add(this._handle);
        this._applyPole();
    }

    /** 连接杆伸缩：伸长杆 90px / 缩短杆 45px（手柄位置随之移动） */
    _applyPole() {
        const hy = this._extended ? 158 : 113;
        this._handle.y(hy);
        this._poleLine.points([0, 68, 0, hy]);
    }

    _bindInteraction() {
        // 测试按钮：按压 → 声光报警 2s（自检）
        const testHit = this.addClickablePart('test', -14, 50, 28, 22);
        testHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this._testT = 2;
        });
        // 连接杆：点击切换伸长 / 缩短
        const poleHit = this.addClickablePart('pole', -9, 70, 18, 80);
        poleHit.on('click tap', (e) => {
            e.cancelBubble = true;
            this._extended = !this._extended;
            this._applyPole();
            if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
        });
    }

    /** 接触头是否接触带电端口（20px 内且 |电压| > 5V） */
    _detectLive() {
        if (!this.sys || !this.sys.comps || !this._tip) return false;
        const tip = this._tip.getAbsolutePosition();
        if (!tip) return false;
        const solver = this.sys.voltageSolver;
        for (const c of Object.values(this.sys.comps)) {
            if (!c || c === this || !c.ports) continue;
            for (const p of c.ports) {
                if (!p || !p.node) continue;
                const w = p.node.getAbsolutePosition();
                if (!w) continue;
                const dx = w.x - tip.x, dy = w.y - tip.y;
                if (dx * dx + dy * dy < 400) {   // 半径 20px
                    let v = 0;
                    try {
                        if (solver && solver.getVoltageAtPort) v = solver.getVoltageAtPort(p.id) || 0;
                    } catch (err) { /* 忽略求解错误 */ }
                    if (Math.abs(v) > 5) return true;
                }
            }
        }
        return false;
    }

    /** 启动蜂鸣（2kHz 方波） */
    _beepStart() {
        try {
            if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this._osc) return;
            const ctx = this._audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            this._osc = ctx.createOscillator();
            this._gain = ctx.createGain();
            this._osc.type = 'square';
            this._osc.frequency.value = 2000;
            this._gain.gain.value = 0.05;
            this._osc.connect(this._gain);
            this._gain.connect(ctx.destination);
            this._osc.start();
        } catch (e) { /* 忽略音频错误 */ }
    }

    /** 停止蜂鸣并清理音频节点 */
    _beepStop() {
        try {
            if (this._osc) { this._osc.stop(); this._osc.disconnect(); this._osc = null; }
            if (this._gain) { this._gain.disconnect(); this._gain = null; }
        } catch (e) { /* 忽略 */ }
    }

    tick(dt) {
        if (this._testT > 0) this._testT -= dt;
        // 接触头带电检测（测试按钮自检与带电接触都会触发声光报警）
        this._live = this._detectLive();
        const alarm = this._live || this._testT > 0;
        if (alarm && !this._alarmOn) this._beepStart();
        if (!alarm && this._alarmOn) this._beepStop();
        this._alarmOn = alarm;
        // 报警灯闪烁（5Hz）
        if (this._alarmOn) this._flashT += dt;
        else this._flashT = 0;
        const lit = this._alarmOn && (Math.floor(this._flashT * 5) % 2 === 0);
        if (this._alarmLed) this._alarmLed.fill(lit ? '#ff2020' : '#7a1515');
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() { return []; }
}