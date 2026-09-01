import { SyncGenerator3P } from './SyncGenerator3P.js';

/**
 * MarineHVGenerator.js
 * 船舶高压发电机组件（继承 SyncGenerator3P，type='source_3p'，复用求解器 stamp）。
 *
 * 界面与同步发电机基本相同：左侧操作台（LCD / 本地遥控转换开关 / 起动停止带灯按钮 /
 * 调速旋钮），右侧发电机本体（定子 + 三相绕组 + 旋转磁极转子）。
 * 布局差异：
 *   - 中性点 N 从顶部移到【原理界面下方】（中性线自定子中心垂直下引，N 端口落底边）；
 *   - 起动/停止/调速遥控接口移到【操作台左边】（落在左边界线上）；
 *   - 右边界新增 4 组接口（自上而下）：
 *       A相出口电流 CT（cta_out_s1/s2）── 接微机综合保护装置（短路/过载/差动保护）
 *       A相入口电流 CT（cta_in_s1/s2） ── 接微机综合保护装置（短路/过载/差动保护）
 *       中性点电流 CT（ctn_s1/s2）     ── 接微机综合保护装置（接地保护）
 *       灭磁继电器   （mc_a/mc_b）     ── 得电（两端同簇）即灭磁：
 *           磁极褪去颜色（无励磁显示）、定子电动势归零；指令断开自动恢复励磁。
 *
 * 高压参数默认值：额定功率 2000kW、额定线电压 6600V（相电压 3810V）、50Hz、
 * 额定功率因数 0.8（额定电流约 218.7A）；内阻 2Ω、AVR 最大补偿 800V(线)，
 * 无功下垂基准 750kvar 时线电压降 330V（5%），满载频率下垂 2Hz（4%）。
 */
export class MarineHVGenerator extends SyncGenerator3P {

    // ─────────────────────────── 几何 ───────────────────────────
    _recalcGeometry() {
        this.width  = 400;
        this.height = 264;

        // 发电机本体（原理区 167~400）
        this._gen = {
            cx: 272, cy: 140,
            rOuter: 68, rInner: 40,
            rRotor: 39, rWinding: 52,
        };

        // 三相出口端口（顶部）；中性点 N 移至底部；灭磁继电器接口位于 W 相右侧
        this._portX = { u: 225, v: 272, w: 318, n: 272, mcA: 354, mcB: 380 };

        // 遥控接口移至左边界线（操作台左边）：起动 / 停止 / 调速
        this._portLeft = {
            startA: 36,  startB: 72,
            stopA:  108, stopB:  144,
            fInP:   180, fInN:   216,
        };

        // 右边界接口带：A相出口CT / A相入口CT / 中性点CT / PT电压输出
        this._portRight = {
            ctaOutS1: 34,  ctaOutS2: 58,
            ctaInS1:  82,  ctaInS2:  106,
            ctNS1:    130, ctNS2:    154,
            ptA:      186, ptB:      210,
        };

        // 操作台控件（与父类一致）；调速旋钮下移15、左移15、再左移10；励磁开关再右移15
        this._ctrl = {
            lcd:   { x: 3, y: 18, w: 152, h: 62 },
            sw:    { x: 78, y: 113 },
            start: { x: 15,  y: 140, w: 57, h: 27 },
            stop:  { x: 85,  y: 140, w: 57, h: 27 },
            knob:  { x: 53, y: 215, r: 20 },   // 调速旋钮
            exc:   { x: 118, y: 215, r: 18 },  // 励磁开关（调速旋钮右侧）
        };
    }

    // ─────────────────────────── 参数 ───────────────────────────
    _initParameters(config) {
        const cfg = Object.assign({
            vRms:         3810,     // 相电压有效值（6600V / √3）
            ratedPower:   2000,     // kW
            ratedVoltage: 6600,
            ratedCosPhi:  0.8,
            rOn:          2,
            maxDropV:     800,
            qDroopVar:    750000,
            vDroopV:      330,
            freqDroop:    2,
        }, config);
        super._initParameters(cfg);
        this.function = '船舶高压发电机';
        this._demagnetized = false;   // true = 灭磁继电器得电，励磁消失
        this._fieldOn = true;         // 面板励磁开关：默认 ON（正常励磁）
    }

    // ─────────────────────────── 静态绘制 ───────────────────────────
    _drawStaticParts() {
        const g = this._gen;
        const W = this.width, H = this.height;

        // 左操作台面板 + 右发电机面板
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: 157, height: H,
            fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 167, y: 0, width: W - 167, height: H,
            fill: '#dfe7ee', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 2, width: 157, text: '船舶高压发电机',
            fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center',
        }));

        // LCD 背景
        const lcd = this._ctrl.lcd;
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));

        // 控制方式开关底座（父类方法）
        this._drawSwitchBase();

        // 起动/停止按钮底座与标签
        [[this._ctrl.start], [this._ctrl.stop]].forEach(([c]) => {
            this._staticGroup.add(new Konva.Rect({
                x: c.x - 2, y: c.y - 2, width: c.w + 4, height: c.h + 4,
                fill: '#cdd8e0', cornerRadius: 4,
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x: this._ctrl.start.x, y: this._ctrl.start.y + this._ctrl.start.h + 2,
            width: this._ctrl.start.w, text: '起动', fontSize: 11,
            fill: '#2e7d32', align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._ctrl.stop.x, y: this._ctrl.stop.y + this._ctrl.stop.h + 2,
            width: this._ctrl.stop.w, text: '停止', fontSize: 11,
            fill: '#b71c1c', align: 'center', fontStyle: 'bold',
        }));

        // 调速旋钮刻度盘
        const knob = this._ctrl.knob;
        this._staticGroup.add(new Konva.Circle({
            x: knob.x, y: knob.y, radius: knob.r + 4,
            fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: knob.x - 40, y: knob.y + knob.r + 4, width: 80,
            text: '减速  ←  加速', fontSize: 11, fill: '#333', align: 'center',
        }));

        // 励磁开关（调速旋钮右侧）：拨杆底盘 + OFF/ON 指示 + 标签
        const exc = this._ctrl.exc;
        this._staticGroup.add(new Konva.Circle({
            x: exc.x, y: exc.y, radius: exc.r + 4,
            fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: exc.x - 28, y: exc.y - exc.r - 16, width: 56,
            text: 'OFF      ON', fontSize: 10, fill: '#333', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: exc.x - 28, y: exc.y + exc.r + 2, width: 56,
            text: '励磁', fontSize: 11, fill: '#333', align: 'center',
        }));

        // ── 发电机本体：定子环 + 通风孔 ──
        this._staticGroup.add(new Konva.Ring({
            x: g.cx, y: g.cy, innerRadius: g.rInner, outerRadius: g.rOuter,
            fill: '#7a8894', stroke: '#2c3a45', strokeWidth: 1,
        }));
        for (let a = 0; a < 360; a += 20) {
            const rad = a * Math.PI / 180;
            this._staticGroup.add(new Konva.Circle({
                x: g.cx + (g.rInner + 4) * Math.cos(rad),
                y: g.cy + (g.rInner + 4) * Math.sin(rad),
                radius: 1.5, fill: '#56646e',
            }));
        }

        // ── 三相绕组（120° 对称：U红 / V绿 / W蓝）──
        const winding = (angDeg, label, fill, stroke, labelColor) => {
            const rad = angDeg * Math.PI / 180;
            const cx = g.cx + g.rWinding * Math.cos(rad);
            const cy = g.cy + g.rWinding * Math.sin(rad);
            this._staticGroup.add(new Konva.Ring({
                x: cx, y: cy, innerRadius: 7, outerRadius: 10,
                fill, stroke, strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 5, y: cy - 3, width: 10, text: label,
                fontSize: 6, fontStyle: 'bold', fill: labelColor, align: 'center',
            }));
        };
        winding(90,  'V', '#20a030', '#0f7018', '#064d12');
        winding(210, 'U', '#e02020', '#8a1010', '#7a0000');
        winding(330, 'W', '#2a60d0', '#163a8a', '#0a2a6a');

        // ── 绕组引线 ──
        const wire = (pts, color, wd = 2) => {
            this._staticGroup.add(new Konva.Line({
                points: pts, stroke: color, strokeWidth: wd,
                lineCap: 'round', lineJoin: 'round',
            }));
        };
        const topY = g.cy - g.rOuter;
        wire([this._portX.v, 88, this._portX.v, 0], '#20a030');
        wire([this._portX.u + 2, 114, this._portX.u, topY, this._portX.u, 0], '#e02020');
        wire([this._portX.w - 2, 114, this._portX.w, topY, this._portX.w, 0], '#2a60d0');
        // 中性线：定子中心 → 原理界面下方 N 端口（底边）
        wire([g.cx, g.cy, this._portX.n, H], '#44505a', 1.4);

        // 定子顶部三个引出孔 + 中心中性点标记
        [this._portX.u, this._portX.v, this._portX.w].forEach(x => {
            this._staticGroup.add(new Konva.Circle({ x, y: topY, radius: 2, fill: '#2c3a45' }));
        });
        this._staticGroup.add(new Konva.Circle({
            x: g.cx, y: g.cy, radius: 3, fill: '#44505a', stroke: '#222',
        }));

        // ── CT 穿芯符号（圆环）：A相出口/入口各一（差动保护区两端）、中性线一（接地保护）──
        const ctMark = (x, y) => {
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: 5.5, fill: 'rgba(255,255,255,0.85)',
                stroke: '#37424d', strokeWidth: 1.6,
            }));
            this._staticGroup.add(new Konva.Text({
                x: x - 9, y: y - 16, width: 18, align: 'center',
                text: 'CT', fontSize: 7, fontStyle: 'bold', fill: '#37424d',
            }));
        };
        ctMark(this._portX.u, 42);          // A相出口 CT（机端引线上部）
        ctMark(this._portX.u, 74);          // A相入口 CT（引线下部）
        ctMark(this._portX.n, g.cy + 66);   // 中性点 CT（中性线下引段）

        // ── 接口标签 ──
        const tag = (x, y, w, txt, align) => {
            this._staticGroup.add(new Konva.Text({
                x, y, width: w, text: txt, fontSize: 9, fill: '#37424d', align,
            }));
        };
        tag(10, 48, 44, '起动', 'left');
        tag(10, 120, 44, '停止', 'left');
        tag(10, 192, 44, '调速', 'left');
        // 顶部灭磁接口标签（W 相右侧端口下方）
        tag(this._portX.mcA - 18, 10, 56, '灭磁', 'center');
        tag(W - 52, 40, 46, 'A相出口CT', 'right');
        tag(W - 52, 88, 46, 'A相入口CT', 'right');
        tag(W - 52, 136, 46, '中性点CT', 'right');
        tag(W - 52, 192, 46, 'PT电压', 'right');
    }

    // ─────────────────────────── 动态节点 ───────────────────────────
    _createDynamicNodes() {
        super._createDynamicNodes();
        // 收集转子磁极矩形（灭磁时褪色用）：N红/S蓝交替
        this._poleRects = [];
        if (this._rotorGroup) {
            this._rotorGroup.children.forEach(c => {
                if (c.className === 'Rect') this._poleRects.push(c);
            });
        }
        // 励磁开关拨杆（持久档位：左45=OFF 关励磁，右45=ON 正常励磁；默认 ON）
        const exc = this._ctrl.exc;
        this._excKnob = new Konva.Group({ x: exc.x, y: exc.y });
        // 先画盘，再画拨杆（拨杆须在圆盘之上，长度与内圆半径一致）
        this._excKnob.add(new Konva.Circle({ x: 0, y: 0, radius: exc.r - 2, fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 1 }));
        this._excKnob.add(new Konva.Line({
            points: [0, 0, 0, -(exc.r - 2)], stroke: '#f1f9f5', strokeWidth: 6, lineCap: 'round',
        }));
        this._excKnob.rotation(this._fieldOn ? 45 : -45);
        this._dynamicGroup.add(this._excKnob);
    }

    // ─────────────────────────── 交互绑定 ───────────────────────────
    _bindInteraction() {
        super._bindInteraction();
        // 励磁开关：点击切换 OFF/ON（左45关励磁，右45正常励磁）
        const exc = this._ctrl.exc;
        const hit = new Konva.Circle({
            x: exc.x, y: exc.y, radius: exc.r + 4, fill: 'transparent', cursor: 'pointer',
        });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            this._fieldOn = !this._fieldOn;
            if (this._excKnob) {
                if (this._excTw) this._excTw.destroy();
                this._excTw = new Konva.Tween({
                    node: this._excKnob, rotation: this._fieldOn ? 45 : -45, duration: 0.18,
                });
                this._excTw.play();
            }
        });
        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hit);
    }

    // ─────────────────────────── 端口 ───────────────────────────
    _addPorts() {
        const p = this._portX, l = this._portLeft, r = this._portRight;
        // 三相出口（顶部）+ 中性点（底部）
        this.addPort(p.u, 0, 'u', 'wire', 'p');
        this.addPort(p.v, 0, 'v', 'wire', 'p');
        this.addPort(p.w, 0, 'w', 'wire', 'p');
        this.addPort(p.n, this.height, 'n', 'wire');
        // 灭磁继电器接口（W 相右侧顶部）
        this.addPort(p.mcA, 0, 'mc_a', 'wire', 'p');
        this.addPort(p.mcB, 0, 'mc_b', 'wire');
        // 遥控接口（左边界：操作台左边）
        this.addPort(0, l.startA, 'rm_start_a', 'wire');
        this.addPort(0, l.startB, 'rm_start_b', 'wire');
        this.addPort(0, l.stopA,  'rm_stop_a',  'wire');
        this.addPort(0, l.stopB,  'rm_stop_b',  'wire');
        this.addPort(0, l.fInP,   'freq_in_p',  'wire', 'p');
        this.addPort(0, l.fInN,   'freq_in_n',  'wire', 'n');
        // 右边界：CT 二次侧端子 + 灭磁继电器线圈
        this.addPort(this.width, r.ctaOutS1, 'cta_out_s1', 'wire');
        this.addPort(this.width, r.ctaOutS2, 'cta_out_s2', 'wire');
        this.addPort(this.width, r.ctaInS1,  'cta_in_s1',  'wire');
        this.addPort(this.width, r.ctaInS2,  'cta_in_s2',  'wire');
        this.addPort(this.width, r.ctNS1,    'ctn_s1',     'wire');
        this.addPort(this.width, r.ctNS2,    'ctn_s2',     'wire');
        // PT 电压输出端子（原灭磁接口位置）
        this.addPort(this.width, r.ptA,      'pt_a',       'wire');
        this.addPort(this.width, r.ptB,      'pt_b',       'wire');
    }

    // ─────────────────────────── 灭磁功能 ───────────────────────────

    /** 灭磁指令检测（两种接法任一满足即得电灭磁）：
     *  ① 触点式：mc_a 与 mc_b 被导线/闭合触点接通（同簇）—— 保护装置出口触点、
     *     外部开关闭合，或直接短接；
     *  ② 电压式：mc_a 与 mc_b 之间有 ≥5V 电位差 —— 操作电源(+/-)接入继电器线圈。 */
    _senseDemag() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver || !solver.portToCluster) return;
        const cA = solver.portToCluster.get(`${this.id}_wire_mc_a`);
        const cB = solver.portToCluster.get(`${this.id}_wire_mc_b`);
        if (cA === undefined || cB === undefined) { this._demagnetized = false; return; }
        if (cA === cB) { this._demagnetized = true; return; }          // ① 触点式
        // ② 电压式：读两端簇电位差
        const vA = solver.nodeVoltages.get(cA) || 0;
        const vB = solver.nodeVoltages.get(cB) || 0;
        this._demagnetized = isFinite(vA) && isFinite(vB) && Math.abs(vA - vB) > 5;
    }

    /** 灭磁视觉：磁极褪色（无励磁）/ 恢复 N红-S蓝 交替着色 */
    _applyDemagVisual() {
        if (!this._poleRects) return;
        this._poleRects.forEach((rect, i) => {
            rect.fill(this._demagnetized ? '#a8adb5' : (i % 2 === 0 ? '#d03030' : '#3060c8'));
            rect.stroke(this._demagnetized ? '#7a8088' : '#8a1a1a');
        });
    }

    /** 灭磁时定子电动势为 0（励磁磁场消失，发电机不发电） */
    getPhaseVoltage(phase, time) {
        if (this._demagnetized) return 0;
        return super.getPhaseVoltage(phase, time);
    }

    /** 灭磁时显示读数覆写：电压严格跟随实测衰减值（归 0），
     *  不回退到空载设定电压；电流/功率随实测归零；频率由原动机保持。 */
    _displayReading() {
        const r = super._displayReading();
        if (this._demagnetized) {
            r.lineV = this._rmsV > 0 ? Math.sqrt(3) * this._rmsV : 0;
            r.freq = (this._freqOut ?? this.freq) || 0;
            r.I = 0;
            r.P = isFinite(this._pwr) ? this._pwr : 0;
            r.cos = 0;
        }
        return r;
    }

    /** LCD 显示（高压机组）：电压取整数（如 6600V），不带小数点 */
    _updateDisplay() {
        const r = this._displayReading();
        const fmt = (v) => v > 100 ? v.toFixed(0) : v.toFixed(1);
        if (this._lcdFreq) {
            this._lcdFreq.text(this.isOn ? `V ${Math.round(r.lineV)}V  F ${r.freq.toFixed(1)}Hz` : 'V--  F--');
        }
        if (this._lcdVolt) {
            this._lcdVolt.text(this.isOn ? `I ${fmt(r.I)}A  P ${fmt(r.P)}kW` : 'I--  P--');
        }
        if (this._lcdRated) {
            this._lcdRated.text(this.isOn ? `COSφ ${r.cos.toFixed(2)}` : 'COS--');
        }
        if (this._startLed) this._startLed.fill(this.isOn ? '#7dffb0' : '#3a3a3a');
        if (this._stopLed) this._stopLed.fill(this.isOn ? '#3a3a3a' : '#ff7d6b');
    }

    // ─────────────────────────── 仿真主循环 ───────────────────────────
    tick(dt) {
        this._senseDemag();
        // 面板励磁开关 OFF：关闭励磁（等同灭磁，磁极褪色、定子无输出）
        if (this._fieldOn === false) this._demagnetized = true;
        super.tick(dt);
        // 灭磁帧冻结 AVR：假压降（3810-0）不得累积补偿量，
        // 否则解除灭磁瞬间输出电压会过冲到补偿上限
        if (this._demagnetized) {
            this._avrTimer = 0;
            this._avrComp = 0;
            this._vRmsOut = 0;
            this._errFilt = 0;
        }
        this._applyDemagVisual();
    }

    // ─────────────────────────── 配置 ───────────────────────────
    getConfigFields() {
        return [
            { label: '空载相电压 (V)', key: 'vRms', type: 'number' },
        ].concat(super.getConfigFields());
    }

    onConfigUpdate(cfg) {
        if (cfg.vRms !== undefined) {
            this.vRms = parseFloat(cfg.vRms) || this.vRms;
            if (!this.isOn) this._vRmsOut = this.vRms;
        }
        super.onConfigUpdate(cfg);
    }

    destroy() { super.destroy?.(); }
}
