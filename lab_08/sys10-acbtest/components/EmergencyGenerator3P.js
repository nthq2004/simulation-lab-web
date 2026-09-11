import { SyncGenerator3P } from './SyncGenerator3P.js';

/**
 * EmergencyGenerator3P 应急发电机组件
 *
 * 基于 SyncGenerator3P，仅保留左侧操作台（LCD + 控制方式旋钮 + 起停按钮 + 调速旋钮），
 * 移除右侧发电机本体原理图。
 *
 * 端口布局：
 *   顶部 4 个端口：u / v / w / n —— 三相输出端口
 *   左侧沿左边界垂直排列 6 个电气端口（从上到下）：
 *     rm_start_a / rm_start_b —— 遥控起动
 *     rm_stop_a  / rm_stop_b  —— 遥控停止
 *     freq_in_p  / freq_in_n  —— 加速/减速指令
 *
 * 面板文字：控制方式从"本地/遥控"改为"本地/自动"。
 */
export class EmergencyGenerator3P extends SyncGenerator3P {
    constructor(config, sys) {
        // ── 只保留操作台宽度，移除右侧发电机本体 ──
        super({ ...config, width: 160 }, sys);
        // super 中已调用 _initGroups / _recalcGeometry / _initParameters / _init / _addPorts
        // 现在用本类覆盖后的几何重建静态层 + 动态层
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._init();
    }

    _recalcGeometry() {
        this.width  = 160;
        this.height = 240;

        // 顶部端口 x（三相 + 中性线）
        this._portX = { u: 28, v: 66, w: 104, n: 136 };

        // 左侧电气端口（遥控起动/停止、加速/减速指令），圆心落在左边界线上
        this._portLeft = {
            x: 0,
            startA: 36,  startB: 72,
            stopA:  108, stopB:  144,
            fInP:   180, fInN:   216,
        };

        // 控制台布局
        this._ctrl = {
            lcd:   { x: 3, y: 18, w: 152, h: 62 },
            sw:    { x: 78, y: 113 },
            start: { x: 15,  y: 140, w: 57, h: 27 },
            stop:  { x: 85,  y: 140, w: 57, h: 27 },
            knob:  { x: 78, y: 200, r: 20 },
        };
    }

    // ═══════════════════════════════════════════
    // 静态绘制（仅操作台，不含发电机本体）
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        // 操作台面板
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));
        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 2, width: this.width,
            text: '应急发电机', fontSize: 12, fontStyle: 'bold',
            fill: '#1a252f', align: 'center',
        }));
        // LCD 背景
        const lcd = this._ctrl.lcd;
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));
        // 控制方式开关（本地 / 自动）
        this._drawSwitchBase();
        // 按钮底座
        this._staticGroup.add(new Konva.Rect({
            x: this._ctrl.start.x - 2, y: this._ctrl.start.y - 2,
            width: this._ctrl.start.w + 4, height: this._ctrl.start.h + 4,
            fill: '#cdd8e0', cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: this._ctrl.stop.x - 2, y: this._ctrl.stop.y - 2,
            width: this._ctrl.stop.w + 4, height: this._ctrl.stop.h + 4,
            fill: '#cdd8e0', cornerRadius: 4,
        }));
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
    }

    /** 控制方式开关底座：左=本地，右=自动（替代原"遥控"） */
    _drawSwitchBase() {
        const sw = this._ctrl.sw;
        this._staticGroup.add(new Konva.Rect({
            x: sw.x - 42, y: sw.y - 18, width: 84, height: 39,
            fill: '#cdd8e0', cornerRadius: 4, stroke: '#5a6a75', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x - 42, y: sw.y - 32, width: 84,
            text: '控制方式', fontSize: 11, fill: '#333', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x - 42, y: sw.y - 15, width: 30,
            text: '手动', fontSize: 11, fill: '#2e7d32', align: 'center', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sw.x + 12, y: sw.y - 15, width: 30,
            text: '自动', fontSize: 11, fill: '#1565c0', align: 'center', fontStyle: 'bold',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（LCD + 旋钮指针 + 按钮灯，不含转子）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        // ── LCD 动态文本 ──
        const lcd = this._ctrl.lcd;
        this._lcdFreq = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 2, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace', fontStyle: 'bold',
            fill: '#00ff88', align: 'left',
        });
        this._lcdVolt = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 22, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace', fontStyle: 'bold',
            fill: '#f4d744', align: 'left',
        });
        this._lcdRated = new Konva.Text({
            x: lcd.x + 4, y: lcd.y + 42, width: lcd.w - 8,
            text: '', fontSize: 14, fontFamily: 'monospace', fontStyle: 'bold',
            fill: '#7dd3ff', align: 'left',
        });
        this._dynamicGroup.add(this._lcdFreq, this._lcdVolt, this._lcdRated);

        // ── 带灯按钮 ──
        this._startFace = new Konva.Rect({
            x: this._ctrl.start.x, y: this._ctrl.start.y,
            width: this._ctrl.start.w, height: this._ctrl.start.h,
            fill: '#2ecc71', cornerRadius: 3, stroke: '#1a7a3a', strokeWidth: 1,
        });
        this._stopFace = new Konva.Rect({
            x: this._ctrl.stop.x, y: this._ctrl.stop.y,
            width: this._ctrl.stop.w, height: this._ctrl.stop.h,
            fill: '#e74c3c', cornerRadius: 3, stroke: '#8a1a1a', strokeWidth: 1,
        });
        this._startLed = new Konva.Circle({
            x: this._ctrl.start.x + this._ctrl.start.w - 9,
            y: this._ctrl.start.y + this._ctrl.start.h / 2,
            radius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 1,
        });
        this._stopLed = new Konva.Circle({
            x: this._ctrl.stop.x + this._ctrl.stop.w - 9,
            y: this._ctrl.stop.y + this._ctrl.stop.h / 2,
            radius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 1,
        });
        this._dynamicGroup.add(this._startFace, this._stopFace, this._startLed, this._stopLed);

        // ── 调速旋钮（与同步发电机一致：白色指针，绕旋钮中心旋转）──
        const knob = this._ctrl.knob;
        this._knobPointer = new Konva.Line({
            x: knob.x, y: knob.y,
            points: [0, 0, 0, -knob.r + 5],
            stroke: '#f1f9f5', strokeWidth: 6, lineCap: 'round',
        });
        this._knobPointer.rotation(0);
        this._knobDisk = new Konva.Circle({
            x: knob.x, y: knob.y, radius: knob.r,
            fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 1,
            cursor: 'pointer',
        });
        this._knobDisk.hitStrokeWidth(20);
        this._dynamicGroup.add(this._knobDisk, this._knobPointer);

        // ── 控制方式转换旋钮（与同步发电机一致：拨杆 + 圆钮，绕中心旋转 ±45°）──
        const sw = this._ctrl.sw;
        this._swIndicator = new Konva.Group({ x: sw.x, y: sw.y + 5 });
        this._swIndicator.add(new Konva.Line({
            points: [0, 0, 0, -16], stroke: '#2c3a45', strokeWidth: 6, lineCap: 'round',
        }));
        this._swIndicator.add(new Konva.Circle({
            x: 0, y: 0, radius: 10, fill: '#2c3a45', stroke: '#161d23', strokeWidth: 2,
        }));
        this._swIndicator.rotation(this.mode === 'local' ? -45 : 45);
        this._dynamicGroup.add(this._swIndicator);

        // ── 父类 _bindInteraction 依赖的节点别名（_knobDisk 已在旋钮段创建）──
        this._switchKnob = this._swIndicator;   // 控制方式转换旋钮
    }

    // ═══════════════════════════════════════════
    // 仿真主循环（单机简化版：无并车、无解列、无拖转、无转子动画）
    // ═══════════════════════════════════════════

    tick(dt) {
        const solver = this.sys && this.sys.voltageSolver;
        if (solver) {
            // ── 遥控起动/停止（控制方式=自动 时有效）──
            const a1 = solver.portToCluster.get(`${this.id}_wire_rm_start_a`);
            const a2 = solver.portToCluster.get(`${this.id}_wire_rm_start_b`);
            const b1 = solver.portToCluster.get(`${this.id}_wire_rm_stop_a`);
            const b2 = solver.portToCluster.get(`${this.id}_wire_rm_stop_b`);
            const remoteStart = a1 !== undefined && a1 === a2;
            const remoteStop  = b1 !== undefined && b1 === b2;
            if (this.mode === 'remote') {
                if (remoteStart) this.isOn = true;
                if (remoteStop)  this.isOn = false; // 停止指令优先
            }

            // ── 原动机保护停机：超速/滑油低压/冷却水温高 → 单机停机，故障未清除前无法起动 ──
            if (this._faultOverspeed || this._faultOilPress || this._faultCoolantTemp) {
                this.isOn = false;
            }

            // ── 加速/减速指令端口：正电压加速、负电压减速 ──
            const cP = solver.portToCluster.get(`${this.id}_wire_freq_in_p`);
            const cN = solver.portToCluster.get(`${this.id}_wire_freq_in_n`);
            if (cP !== undefined && cN !== undefined) {
                const vP = solver.nodeVoltages.get(cP) || 0;
                const vN = solver.nodeVoltages.get(cN) || 0;
                this._remoteRate = (isFinite(vP) && isFinite(vN)) ? this._remoteGain * (vP - vN) : 0;
            } else {
                this._remoteRate = 0;
            }

            // ── 实际输出测量：每相电流=(源电动势-相端电压)/内阻，滑窗 RMS 与有功功率 ──
            if (this.isOn && this.isOn === this._prevIsOn) {
                const advanced = solver.globalIterCount !== this._lastMeasIter;
                this._lastMeasIter = solver.globalIterCount;
                if (advanced) {
                    const getV = (pId) => {
                        const c = solver.portToCluster.get(pId);
                        return c !== undefined ? (solver.nodeVoltages.get(c) || 0) : 0;
                    };
                    const vN = getV(`${this.id}_wire_n`);
                    const emfU = this.getPhaseVoltage('u', solver.currentTime);
                    const emfV = this.getPhaseVoltage('v', solver.currentTime);
                    const emfW = this.getPhaseVoltage('w', solver.currentTime);
                    const vu = getV(`${this.id}_wire_u`) - vN;
                    const vv = getV(`${this.id}_wire_v`) - vN;
                    const vw = getV(`${this.id}_wire_w`) - vN;
                    const rOn = this.rOn || 0.01;
                    const iu = (emfU - vu) / rOn;
                    const iv = (emfV - vv) / rOn;
                    const iw = (emfW - vw) / rOn;

                    const win = this._measWin;
                    const iMax = this.ratedCurrent * 6;
                    const sane = (v) => Math.abs(v) < iMax;
                    const push = (arr, v) => { arr.push(v * v); if (arr.length > win) arr.shift(); };
                    if (sane(iu) && sane(iv) && sane(iw)) {
                        push(this._curBufU, iu);
                        push(this._curBufV, iv);
                        push(this._curBufW, iw);
                        push(this._vBufU, vu);
                        push(this._vBufV, vv);
                        push(this._vBufW, vw);
                        this._pBuf.push((vu * iu + vv * iv + vw * iw) / 1000);
                        if (this._pBuf.length > win) this._pBuf.shift();
                    }
                    const avg = (arr) => arr.length > 0 ? Math.sqrt(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
                    const rU = avg(this._curBufU), rV = avg(this._curBufV), rW = avg(this._curBufW);
                    this._rmsI = Math.max(rU, rV, rW);
                    this._rmsV = (avg(this._vBufU) + avg(this._vBufV) + avg(this._vBufW)) / 3;
                    this._pwr = this._pBuf.length > 0 ? this._pBuf.reduce((a, b) => a + b, 0) / this._pBuf.length : 0;
                }
            } else {
                // 停机/起动翻转：清空测量窗
                this._curBufU.length = this._curBufV.length = this._curBufW.length = 0;
                this._vBufU.length = this._vBufV.length = this._vBufW.length = 0;
                this._pBuf.length = 0;
                this._rmsI = 0;
                this._pwr = 0;
                this._rmsV = 0;
            }
            // 单机运行：显示功率直接取内部真实功率（无并车教学修正）
            this._displayP = isFinite(this._pwr) ? this._pwr : 0;
            this._displayFreq = this._freqOut;
            this._prevIsOn = this.isOn;
        }

        // ── 频率积分调节（手动旋钮 + 遥控指令叠加），夹紧上下限 ──
        const rate = this._knobDir * this._manualRate + this._remoteRate;
        if (rate !== 0 || dt > 0) {
            this.freq = Math.max(this.freqMin, Math.min(this.freqMax, this.freq + rate * dt));
        }

        // ── 调差特性（单机）：频率-有功下垂 + 电压-无功下垂/AVR ──
        if (this.isOn) {
            // 下垂用功率限幅：±2×额定功率，防止测量瞬态发散
            const clampP = (p) => Math.max(-2 * p.ratedPower, Math.min(2 * p.ratedPower, p._pwr));
            const Pkw = clampP(this);
            const fTarget = this.ratedPower > 0
                ? this.freq - (Pkw / this.ratedPower) * this.freqDroop
                : this.freq;

            // 频率二阶动态（阻尼响应）
            const wn = this._wn, zeta = this._zeta;
            if (!isFinite(this._freq) || !isFinite(this._freqRate)) {
                this._freq = this.freq;
                this._freqRate = 0;
            }
            const accel = wn * wn * (fTarget - this._freq) - 2 * zeta * wn * this._freqRate;
            this._freqRate += accel * dt;
            this._freq += this._freqRate * dt;
            this._freqOut = this._freq;

            // ── 无功计算（电流限幅防冲击）──
            const lineVset = Math.sqrt(3) * this.vRms;
            const Ilimit = this.ratedCurrent;
            const S = Math.sqrt(3) * lineVset * Math.min(this._rmsI, Ilimit);
            const P = Pkw * 1000;
            const Q = Math.sqrt(Math.max(0, S * S - P * P));
            this._qVar = Q;

            // ── AVR 闭环：误差比例减速 + 记忆保持（死区 + 低通）──
            const termV = this._rmsV > 0 ? this._rmsV : this.vRms;
            const dropPh = this.vRms - termV;
            this._errFilt = (this._errFilt || 0) + (dropPh - (this._errFilt || 0)) * Math.min(1, dt / 0.2);
            const db = 1.0, satErr = 10, maxC = this.avrMaxComp || 1.0;
            const errAbs = Math.abs(this._errFilt);
            const kRate = Math.min(1, Math.max(0, (errAbs - db) / (satErr - db)));
            const avrRate = (1 / (this.avrTime * 1.5)) * dt * kRate;
            if (this._errFilt > db) {
                this._avrTimer += dt;
                if (this._avrTimer >= this.avrDelay) {
                    this._avrComp = Math.min(maxC, this._avrComp + avrRate);
                }
            } else if (this._errFilt < -db) {
                this._avrTimer = 0;
                this._avrComp = Math.max(0, this._avrComp - avrRate);
            }
            this._vRmsOut = Math.max(0.5 * this.vRms, Math.min(1.3 * this.vRms,
                this.vRms + (this.maxDropV / Math.sqrt(3)) * this._avrComp));

            // ── 故障注入（优先级最高，覆盖正常调节结果）──
            if (this._faultGovernor) {
                this._freq = 25; this._freqRate = 0; this._freqOut = 25;
                this._vRmsOut = 280 / Math.sqrt(3);
            }
            if (this._faultAVR) {
                this._vRmsOut = 200 / Math.sqrt(3);
            }
        } else {
            this._freqOut = this.freq;
            this._freq = this.freq;
            this._freqRate = 0;
            this._vRmsOut = this.vRms;
            this._avrTimer = 0;
            this._avrComp = 0;
            this._qVar = 0;
        }

        this._updateDisplay();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════
    // 端口：顶部 4 个三相输出，左侧 6 个控制端口
    // ═══════════════════════════════════════════

    _addPorts() {
        const p = this._portX;
        const r = this._portLeft;
        this.addPort(p.u, 0, 'u', 'wire', 'p');
        this.addPort(p.v, 0, 'v', 'wire', 'p');
        this.addPort(p.w, 0, 'w', 'wire', 'p');
        this.addPort(p.n, 0, 'n', 'wire');
        this.addPort(r.x, r.startA, 'rm_start_a', 'wire');
        this.addPort(r.x, r.startB, 'rm_start_b', 'wire');
        this.addPort(r.x, r.stopA,  'rm_stop_a',  'wire');
        this.addPort(r.x, r.stopB,  'rm_stop_b',  'wire');
        this.addPort(r.x, r.fInP,   'freq_in_p',  'wire', 'p');
        this.addPort(r.x, r.fInN,   'freq_in_n',  'wire', 'n');
    }

    // ═══════════════════════════════════════════
    // 配置对话框（移除发电机专有字段）
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称',      key: 'label',        type: 'text' },
            { label: '设定频率 (Hz)',   key: 'freq',         type: 'number', min: 45, max: 55, step: 0.1 },
            { label: '额定功率 (kW)',   key: 'ratedPower',   type: 'number', min: 1, step: 1 },
            { label: '额定电压 (V)',    key: 'ratedVoltage',  type: 'number', min: 100, step: 10 },
            { label: '功率因数 cosφ',  key: 'ratedCosPhi',  type: 'number', min: 0.5, max: 1, step: 0.01 },
            { label: '内阻 (Ω)',       key: 'rOn',          type: 'number', min: 0, step: 0.01 },
            { label: '运行状态',        key: 'isOn',         type: 'select', options: [
                { label: '运行', value: true },
                { label: '停止', value: false },
            ]},
            { label: '控制方式',        key: 'mode',         type: 'select', options: [
                { label: '手动', value: 'local' },
                { label: '自动', value: 'remote' },
            ]},
        ];
    }
}
