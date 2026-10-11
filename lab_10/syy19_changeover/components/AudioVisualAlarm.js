import { BaseComponent } from './BaseComponent.js';

/**
 * 声光报警器仿真组件
 * （Audio-Visual Alarm / Annunciator）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  声光报警器内置继电器控制电路：
 *
 *  两个电气接口：
 *    端口 A（COM）— 公共端（连接报警信号源）
 *    端口 B（IN） — 触发输入端
 *
 *  当 A、B 两端接通（连接）时：
 *    → 内部继电器吸合
 *    → 警报蜂鸣器激励（间歇鸣响，频率约 1~3 Hz）
 *    → 警示灯（Xenon/LED 频闪灯）闪烁（约 60 次/分）
 *    → 报警状态锁存（latching）
 *
 *  按下复位按钮（RESET）：
 *    → 消音（蜂鸣器停止）
 *    → 消闪（指示灯停止闪烁）
 *    → 若 A-B 仍导通：灯保持常亮（仅消闪，故障仍在）
 *    → 若 A-B 已断开：恢复静默（完全复位）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 工业方形外壳（IP54/IK08，红色环氧涂装）
 *  ② 顶部警示灯罩（旋转灯笼/频闪灯，半透明红色）
 *  ③ 前面板显示区（ALARM 铭牌 + 状态指示条）
 *  ④ 复位按钮（RESET，正面中央，金属按钮）
 *  ⑤ 接线端子（底部，两个电气接口 A/B）
 *  ⑥ 声音波形动画（喇叭发声可视化）
 *  ⑦ 闪光光晕动画（灯罩光晕脉冲）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_a  — 公共端 A（COM）
 *  wire_b  — 触发输入 B（IN）
 *
 * ── 外部控制 ──────────────────────────────────────────────────
 *  trigger()    — 模拟 A-B 接通（触发报警）
 *  release()    — 模拟 A-B 断开
 *  reset()      — 按下复位按钮
 *  connect(on)  — 设置接线状态
 */
export class AudioVisualAlarm extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type    = 'audio_visual_alarm';
        this.special = 'none';
        // 灯光/声波为逐帧动画，不适用静态位图缓存；动态件在 tick 中 in-place 更新。
        this.cache   = 'fixed';

        // 规范顺序：_initGroups → _recalcGeometry → _initParameters → _init
        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);

        this.config = { id: this.id, color: this.color, flashRate: this.flashRate };

        this._init();

        // 端口
        this.addPort(this._termAX, this.height - 24, 'l', 'wire', 'p');
        this.addPort(this._termBX, this.height - 24, 'r', 'wire');
    }

    // ═══════════════════════════════════════════
    // 几何布局
    // ═══════════════════════════════════════════
    _recalcGeometry(config) {
        this.width  = Math.max(140, config.width  || 160);
        this.height = Math.max(220, config.height || 260);
        const cx = this.width / 2;

        // 灯笼（顶部）
        this._lampX = cx;
        this._lampY = Math.round(this.height * 0.20);
        this._lampR = Math.round(this.width * 0.28);

        // 机壳
        this._bodyX = Math.round(this.width * 0.08);
        this._bodyY = Math.round(this.height * 0.34);
        this._bodyW = Math.round(this.width * 0.84);
        this._bodyH = Math.round(this.height * 0.52);

        // 复位按钮
        this._btnX = cx;
        this._btnY = this._bodyY + Math.round(this._bodyH * 0.65);
        this._btnR = Math.round(this.width * 0.10);

        // 端子（底部）
        this._termY  = this._bodyY + this._bodyH + 2;
        this._termAX = Math.round(this.width * 0.30);
        this._termBX = Math.round(this.width * 0.70);
    }

    // ═══════════════════════════════════════════
    // 参数
    // ═══════════════════════════════════════════
    _initParameters(config) {
        this.flashRate    = config.flashRate    || 60;    // 次/分
        this.beepFreqLow  = config.beepFreqLow  || 1.5;   // Hz（低鸣速）
        this.beepFreqHigh = config.beepFreqHigh || 3.0;   // Hz（高鸣速）
        this.soundVolume  = config.soundVolume  || 100;   // dB（显示用）
        this.color        = config.color        || 'red'; // 'red'|'amber'|'blue'|'green'

        this._colorMap = {
            red:   { body: '#c62828', bodyDk: '#8a0000', lens: '#ef5350', lensGlow: '#ff1744', bezel: '#b71c1c' },
            amber: { body: '#f57f17', bodyDk: '#b34700', lens: '#ffa726', lensGlow: '#ffab00', bezel: '#e65100' },
            blue:  { body: '#1565c0', bodyDk: '#003c8f', lens: '#42a5f5', lensGlow: '#2979ff', bezel: '#0d47a1' },
            green: { body: '#2e7d32', bodyDk: '#005a08', lens: '#66bb6a', lensGlow: '#00c853', bezel: '#1b5e20' },
        };
        this._col = this._colorMap[this.color] || this._colorMap.red;

        // ── 状态 ──
        this.connected = false;
        this.alarming  = false;
        this.silenced  = false;
        this.isBreak   = false;

        // ── 动画 ──
        this._flashPhase   = 0;
        this._beepPhase    = 0;
        this._rotateAngle  = 0;
        this._glowPulse    = 0;
        this._soundWave    = 0;
        this._lampOn       = false;
        this._beepOn       = false;
        this._btnPressAnim = 0;
        this._ripplePhase  = 0;

        this.knobs = {};
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // 静态件（入 _staticGroup）——本组件 cache=false，仍按规范分层
    _drawStaticParts() {
        this._drawLabel();
        this._drawLampLens();
        this._drawBody();
        this._drawResetButton();
        this._drawTerminals();
    }

    // 动态件（入 _dynamicGroup）：涟漪/声波节点、灯芯/辉光/高光
    _createDynamicNodes() {
        // 先创建动态层（涟漪/声波弧/蜂鸣点等预建节点），再做静态/动态分区
        this._drawDynamicLayers();

        const container = this.scaleGroup || this.group;
        const dyn = this._dynamicGroup;
        const st = this._staticGroup;
        if (!dyn || !st || !container) return;

        // 零漏判规则：凡是被 this._X 引用的节点一律进动态组 —— 它们在运行时
        // 很可能被 text/fill/rotation/width 等轻量 setter 更新，误入静态组会被
        // init 时建立的位图"冻住"（表现为数据变了画面不刷新）。
        // 只有**无字段引用的匿名节点**（绘制时直接 scaleGroup.add(new Konva.Rect(...))）
        // 才留在静态组，也就是外壳、面板、边框、管路这类真正不变的内容。
        const DYN_FIELDS = [
            '_alarmText',
            '_btnBody',
            '_btnText',
            '_glowCircle',
            '_lampCore',
            '_lensHighlight',
            '_lensInner',
            '_lensOuter',
            '_rippleGroup',
            '_soundGroup',
            '_statusBar',
            '_statusFill',
            '_statusLbl',
            '_termABlock',
            '_termBBlock',
        ];
        const dynSet = new Set();
        const mark = n => {
            if (n && typeof n === 'object' && typeof n.getParent === 'function') dynSet.add(n);
        };
        DYN_FIELDS.forEach(f => mark(this[f]));

        // 祖先链提升：动态节点所在的所有祖先组都必须进动态组，
        // 否则祖先被缓存后，其内部的动态子节点同样会被位图冻结。
        Array.from(dynSet).forEach(n => {
            let p = n.getParent ? n.getParent() : null;
            while (p && p !== container && p !== this.group) {
                dynSet.add(p);
                p = p.getParent ? p.getParent() : null;
            }
        });

        // 按容器原有子节点顺序搬运，保持原本的层叠次序
        let kids = [];
        try { kids = Array.prototype.slice.call(container.getChildren()); } catch (e) { kids = []; }
        kids.forEach(n => {
            if (n === dyn || n === st || n === this._interactGroup) return;
            if (dynSet.has(n)) dyn.add(n); else st.add(n);
        });
    };

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -10, width: this.width,
            text: '声光报警器', fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 灯笼透镜（主光源）────────────────────
    _drawLampLens() {
        const cx = this._lampX, cy = this._lampY, R = this._lampR;
        const col = this._col;

        // 辉光层（动态，在下方先渲染）
        this._glowCircle = new Konva.Circle({ x: cx, y: cy, radius: R*1.7, fill: 'rgba(0,0,0,0)' });

        // 灯笼外罩（半透明红色塑料）
        this._lensOuter = new Konva.Circle({ x: cx, y: cy, radius: R, fill: col.lens, stroke: col.bezel, strokeWidth: 2.5, opacity: 0.85 });
        // 灯笼内腔（反射腔，深色）
        this._lensInner = new Konva.Circle({ x: cx, y: cy, radius: R*0.62, fill: '#1a0000' });
        // 内光源（动态强度）
        this._lampCore  = new Konva.Circle({ x: cx, y: cy, radius: R*0.35, fill: '#1a0000' });
        // 灯笼棱纹（装饰性环形）
        for (let i = 1; i <= 4; i++) {
            this._staticGroup.add(new Konva.Circle({ x: cx, y: cy, radius: R*i/4, fill: 'none', stroke: `rgba(255,255,255,0.10)`, strokeWidth: 0.8 }));
        }
        // 高光反射（顶部左侧弧形）
        this._lensHighlight = new Konva.Arc({ x: cx-R*0.22, y: cy-R*0.25, innerRadius: R*0.35, outerRadius: R*0.38, angle: 55, rotation: 200, fill: 'rgba(255,255,255,0.35)' });

        // 灯腔外壳/内腔为静态件；辉光、灯芯、高光为动态件（每帧 in-place 更新），
        // 放入 _dynamicGroup，避免被静态位图缓存固化。
        this._staticGroup.add(this._lensOuter, this._lensInner);
        this._dynamicGroup.add(this._glowCircle, this._lampCore, this._lensHighlight);
    }

    // ── 主机壳 ────────────────────────────────
    _drawBody() {
        const bx = this._bodyX, by = this._bodyY;
        const bw = this._bodyW, bh = this._bodyH;
        const col = this._col;

        // 外壳主体
        const body = new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: col.body, stroke: col.bezel, strokeWidth: 2, cornerRadius: 5 });
        // 顶面高光
        this._staticGroup.add(new Konva.Rect({ x: bx+2, y: by+2, width: bw-4, height: 5, fill: 'rgba(255,255,255,0.15)', cornerRadius: [3,3,0,0] }));
        // 底面暗影
        this._staticGroup.add(new Konva.Rect({ x: bx+2, y: by+bh-7, width: bw-4, height: 5, fill: 'rgba(0,0,0,0.22)', cornerRadius: [0,0,3,3] }));

        // 品牌 ALARM 铭牌
        const nameH = Math.round(bh * 0.22);
        const nameBg = new Konva.Rect({ x: bx+6, y: by+6, width: bw-12, height: nameH, fill: '#1a0000', stroke: 'rgba(0,0,0,0.3)', strokeWidth: 0.5, cornerRadius: 2 });
        this._alarmText = new Konva.Text({ x: bx+6, y: by+15, width: bw-12, text: '★ ALARM ★', fontSize: 12, fontStyle: 'bold', fontFamily: 'Arial Narrow, sans-serif', fill: col.lens, align: 'center', letterSpacing: 2 });

        // 状态指示条（铭牌下方）
        const barY = by + nameH + 10;
        const barH = 8;
        this._statusBar = new Konva.Rect({ x: bx+8, y: barY, width: bw-16, height: barH, fill: '#1a0000', cornerRadius: 2 });
        this._statusFill = new Konva.Rect({ x: bx+9, y: barY+1, width: 0, height: barH-2, fill: col.lens, cornerRadius: 1 });
        this._statusLbl = new Konva.Text({ x: bx+8, y: barY+barH+2, width: bw-16, text: '● 静默', fontSize: 11, fill: 'rgba(255,255,255,0.65)', align: 'center' });

        // 喇叭网格（左下角）
        const grillX = bx+6, grillY = by+bh*0.48;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 4; c++) {
                this._staticGroup.add(new Konva.Circle({ x: grillX+5+c*8, y: grillY+5+r*7, radius: 2.5, fill: '#1a0000', opacity: 0.5 }));
            }
        }
        this._staticGroup.add(new Konva.Text({ x: grillX, y: grillY+25, width: 36, text: `${this.soundVolume}dB`, fontSize: 7.5, fill: 'rgba(255,255,255,0.35)', align: 'center' }));

        // 接线盒指示（右下角）
        const termLblX = bx + bw - 38;
        this._staticGroup.add(new Konva.Text({ x: termLblX, y: by+bh*0.52, width: 32, text: 'IN\n▼', fontSize: 8, fill: 'rgba(255,255,255,0.40)', align: 'center', lineHeight: 1.2 }));

        this._staticGroup.add(body, nameBg, this._alarmText, this._statusBar, this._statusFill, this._statusLbl);
    }

    // ── 复位按钮 ─────────────────────────────
    _drawResetButton() {
        const cx = this._btnX, cy = this._btnY, R = this._btnR;
        // 按钮主体（金属按钮）
        this._btnBody = new Konva.Circle({ x: this._btnX, y: this._btnY, radius: R, fill: '#eceff1', stroke: '#78909c', strokeWidth: 1.5 });
        // 按钮凹槽
        const _btnOut =new Konva.Circle({ x: this._btnX, y: this._btnY, radius: R+4, fill: 'rgba(0,0,0,0.30)' });
        // RESET 文字
        this._btnText = new Konva.Text({ x: cx-R-15, y: cy+R+5, width: 60, text: 'RESET', fontSize: 12, fontStyle: 'bold', fill: '#37474f', align: 'center' });
        // 点击事件
        this._btnBody.on('mousedown touchstart', () => {
            this._btnPressAnim = 1;
            this.reset();
        });
        this._interactGroup.add(this._btnText,_btnOut,this._btnBody);
    }

    // ── 接线端子（底部）─────────────────────
    _drawTerminals() {
        const ty = this._termY;
        // 端子块背景
        this._staticGroup.add(new Konva.Rect({ x: this._bodyX, y: ty, width: this._bodyW, height: 20, fill: '#263238', stroke: '#1a2634', strokeWidth: 1, cornerRadius: [0,0,3,3] }));
        // A 端子
        this._termABlock = new Konva.Rect({ x: this._termAX-10, y: ty+2, width: 20, height: 16, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 });
        // B 端子
        this._termBBlock = new Konva.Rect({ x: this._termBX-10, y: ty+2, width: 20, height: 16, fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.8, cornerRadius: 2 });
        this._staticGroup.add(this._termABlock,  this._termBBlock);
    }

    // ── 动态层 ────────────────────────────────
    //  全部动态节点一次性创建，之后仅在 tick 中 in-place 更新属性（不销毁重建）。
    _drawDynamicLayers() {
        // 灯罩扩散涟漪：预建 2 个圆
        this._rippleGroup = new Konva.Group();
        this._ripples = [];
        for (let i = 0; i < 2; i++) {
            const c = new Konva.Circle({
                x: this._lampX, y: this._lampY, radius: 0,
                fill: 'none', stroke: this._col.lensGlow, strokeWidth: 2.5, visible: false, listening: false,
            });
            this._rippleGroup.add(c);
            this._ripples.push(c);
        }

        // 声波弧线：预建 4 个 Arc
        this._soundGroup = new Konva.Group();
        const grillX  = this._bodyX + 6;
        const grillCX = grillX + 18;
        const grillCY = this._bodyY + this._bodyH * 0.62;
        this._soundArcs = [];
        for (let i = 1; i <= 4; i++) {
            const a = new Konva.Arc({
                x: grillCX, y: grillCY,
                innerRadius: i * 10, outerRadius: i * 10 + 1.5,
                angle: 120, rotation: -60,
                fill: 'rgba(255,200,100,0)', visible: false, listening: false,
            });
            this._soundGroup.add(a);
            this._soundArcs.push(a);
        }

        // 蜂鸣器振动点：预建 3×4 个小圆
        this._beepDots = [];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 4; j++) {
                const d = new Konva.Circle({
                    x: grillX + 5 + j * 8, y: this._bodyY + this._bodyH * 0.48 + 5 + i * 7,
                    radius: 2.5, fill: 'rgba(255,200,100,0)', visible: false, listening: false,
                });
                this._soundGroup.add(d);
                this._beepDots.push(d);
            }
        }

        this._dynamicGroup.add(this._rippleGroup, this._soundGroup);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickLogic(dt);
        this._tickLamp(dt);
        this._tickSound(dt);
        this._tickButton(dt);
        this._tickDisplay();
        // 静态位图仅在内容变化时限频重建
        this.markDirty();
        this._refreshIfDirty();
    }
    // ── 控制逻辑 ─────────────────────────────
    _tickLogic(dt) {
        this.connected = this.sys.isPortConnected(`${this.id}_wire_l`,`${this.id}_wire_r`);
        // 接通时触发报警（锁存）
        if (this.connected && !this.alarming) {
            this.alarming = true;
            this.silenced = false;
        }

        // 未接通时，若已复位则清除报警
        if (!this.connected && this.silenced) {
            this.alarming = false;
            this.silenced = false;
        }

        // 闪光逻辑
        const flashHz = this.flashRate / 60;
        this._flashPhase += dt * flashHz * 2 * Math.PI;

        // 蜂鸣逻辑（间歇双音调）
        const beepHz = this.alarming && !this.silenced ? this.beepFreqHigh : 0;
        this._beepPhase += dt * beepHz * 2 * Math.PI;

        // 旋转角（灯旋转）
        if (this.alarming && !this.silenced) {
            this._rotateAngle += dt * 180;  // 半圈/秒
        }

        // 声波相位
        this._soundWave  += dt * 8;
        this._ripplePhase+= dt * 3;
    }

    // ── 灯光动画 ─────────────────────────────
    _tickLamp(dt) {
        const col = this._col;
        const active = this.alarming && !this.silenced;
        const steady = this.alarming && this.silenced;

        // 决定灯状态
        let lampBrightness = 0;
        if (active) {
            // 闪烁（正弦波形式）
            lampBrightness = Math.max(0, Math.sin(this._flashPhase));
        } else if (steady) {
            lampBrightness = 0.7;  // 常亮（已消闪但故障仍在）
        }

        this._lampOn = lampBrightness > 0.3;

        // 透镜颜色
        const r = lampBrightness;
        if (this._lensOuter) {
            const alpha = 0.65 + r * 0.35;
            this._lensOuter.opacity(alpha);
        }
        // 灯芯亮度
        if (this._lampCore) {
            if (r > 0.1) {
                const intR = Math.round(200 + r * 55);
                const intG = Math.round(r * 80);
                this._lampCore.fill(`rgb(${intR},${intG},0)`);
            } else {
                this._lampCore.fill('#1a0000');
            }
        }

        // 扩散光晕涟漪（预建节点，in-place 更新）
        const showRipple = active && r > 0.5;
        for (let i = 0; i < this._ripples.length; i++) {
            const c = this._ripples[i];
            if (!showRipple) { c.visible(false); continue; }
            const rp = ((this._ripplePhase + i * 1.5) % (Math.PI * 2)) / (Math.PI * 2);
            c.visible(true);
            c.radius(this._lampR * (1 + rp * 0.9));
            c.opacity(0.2 * (1 - rp) * r);
            c.stroke(col.lensGlow);
        }

        // 灯罩颜色（根据颜色配置）
        if (this._lensHighlight) {
            this._lensHighlight.fill(r > 0.3 ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.25)');
        }
    }

    // ── 声音波形可视化 ───────────────────────
    //  预建节点 in-place 更新，避免每帧 destroyChildren()+add()。
    _tickSound(dt) {
        const silent = !this.alarming || this.silenced;
        const beepBrightness = silent ? 0 : Math.max(0, Math.sin(this._beepPhase));
        this._beepOn = beepBrightness > 0.2;

        // 扩散声波（向两侧辐射）
        for (let k = 0; k < this._soundArcs.length; k++) {
            const arc = this._soundArcs[k];
            const alpha = Math.max(0, 0.35 - (k + 1) * 0.07) * beepBrightness;
            if (alpha < 0.02) { arc.visible(false); continue; }
            arc.visible(true);
            arc.fill(`rgba(255,200,100,${alpha})`);
        }

        // 蜂鸣器振动点
        let di = 0;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 4; j++, di++) {
                const dot = this._beepDots[di];
                const bv = silent ? 0
                    : (Math.sin(this._soundWave + i * 0.8 + j * 0.6) * 0.3 + 0.7) * beepBrightness;
                if (bv < 0.3) { dot.visible(false); continue; }
                dot.visible(true);
                dot.fill(`rgba(255,200,100,${bv * 0.6})`);
            }
        }
    }

    // ── 按钮动画 ─────────────────────────────
    _tickButton(dt) {
        this._btnPressAnim = Math.max(0, this._btnPressAnim - dt * 6);
        if (this._btnBody) {
            const press = this._btnPressAnim;
            const col   = press > 0.1 ? '#b0bec5' : '#eceff1';
            this._btnBody.fill(col);

        }
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const col = this._col;

        // ALARM 文字颜色（激活时更亮）
        if (this._alarmText) {
            const bright = this.alarming ? (this._lampOn ? '#ffffff' : col.lens) : col.lens;
            this._alarmText.fill(bright);
            this._alarmText.opacity(this.alarming ? 1 : 0.6);
        }

        // 状态条
        if (this._statusFill) {
            const fillW = this.connected ? (this._bodyW - 18) : 0;
            this._statusFill.width(fillW);
        }

        // 状态文字
        if (this._statusLbl) {
            if (this.isBreak)          { this._statusLbl.text('⚠ 断线故障'); this._statusLbl.fill('#ef5350'); }
            else if (!this.connected && !this.alarming) { this._statusLbl.text('● 静默'); this._statusLbl.fill('rgba(255,255,255,0.55)'); }
            else if (this.alarming && !this.silenced)   { this._statusLbl.text('▶ 报 警！'); this._statusLbl.fill('#ffffff'); }
            else if (this.alarming && this.silenced)    { this._statusLbl.text('◆ 已消音'); this._statusLbl.fill('#ffd54f'); }
        }

    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════

    /** 接通 A-B 接口（触发报警） */
    trigger() {
        this.connected = true;
        this.markDirty();
        this._refreshIfDirty(true);
    }

    /** 断开 A-B 接口 */
    release() {
        this.connected = false;
        this.markDirty();
        this._refreshIfDirty(true);
    }

    /** 设置连接状态 */
    connect(on) {
        this.connected = !!on;
        this.markDirty();
        this._refreshIfDirty(true);
    }

    /** 按下复位按钮 */
    reset() {
        if (this.alarming) {
            if (this.connected) {
                // 故障仍在：消音消闪，但保持报警状态（常亮）
                this.silenced = true;
            } else {
                // 故障已消除：完全复位
                this.alarming = false;
                this.silenced = false;
            }
        }
        this._btnPressAnim = 1;
        this.markDirty();
        this._refreshIfDirty(true);
    }

    /** 气路求解器接口（press 非零时触发） */
    update(press, flow) {
        const triggered = press !== undefined && press > 0;
        this.connect(triggered);
        this.markDirty();
        this._refreshIfDirty(true);
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',         type: 'text'   },
            { label: '报警灯颜色',          key: 'color',      type: 'select',
              options: [
                  { label: '红色', value: 'red'   },
                  { label: '琥珀', value: 'amber' },
                  { label: '蓝色', value: 'blue'  },
                  { label: '绿色', value: 'green' },
              ]},
            { label: '闪光频率 (次/分)',    key: 'flashRate',  type: 'number' },
            { label: '声压级 (dB)',         key: 'soundVolume',type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.flashRate   = parseFloat(cfg.flashRate)   || this.flashRate;
        this.soundVolume = parseFloat(cfg.soundVolume) || this.soundVolume;
        if (cfg.color && this._colorMap[cfg.color]) {
            this.color = cfg.color;
            this._col  = this._colorMap[cfg.color];
        }
        this.config = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty(true);
    }

    destroy() {
        super.destroy?.();
    }
}