/**
 * Multimeter3D —— 真 3D 数字万用表（桌面式）
 *
 * 功能与 2D 版 components/Multimeter.js 一致：
 *   · 12 个档位：OFF / DCVmv / DCV20 / DCV200 / ACV200 / ACV500 /
 *     DIODE / RES200 / RES2k / RES200k / MA / C，点击旋钮逐档切换；
 *   · 端口 ma / com / v 与 2D 版完全同名 → 直接复用求解内核
 *     DeviceStamps.stampMultimeters 的注入（电流档 0.2Ω 分流、
 *     电阻/二极管档恒流源 + 顺从电阻、电容档 1mA 充电）；
 *   · tick() 按档位取数（直流电压取 v-com 电位差、交流电压 RMS、
 *     电阻档 V/iSet、二极管档管压降与 <5Ω 蜂鸣、电容档 C=I·t/ΔV）；
 *   · 显示格式化规则（单位、精度、O.L 溢出）与 2D 版逐条对齐。
 * 视觉模型：three.js 桌面表（外壳 + 面板 + LCD 屏 + 档位旋钮 + 三个插孔），
 *   由宿主 Circuit3DScene 统一渲染与射线拾取；LCD 用 CanvasTexture 实时刷新。
 */
import * as THREE from 'three';                                     // three.js 命名空间（本组件自建 3D 模型与贴图）
import { BaseComponent } from '../components/BaseComponent.js';     // 平台组件基类：端口/配置框/分组等公共能力
import { WORLD } from './world3d.js';                                // 世界常量：桌面高度、万用表摆放位置

/** 档位表：与 2D 版 _drawScaleLabels 的角度一一对应（0°=顶，顺时针为正） */
const DIAL = [
    { mode: 'OFF',     label: 'OFF',   angle: 0 },                   // 关机
    { mode: 'DIODE',   label: '▶|))',  angle: 30 },                  // 二极管/通断
    { mode: 'RES200',  label: '200Ω',  angle: 60 },                  // 电阻 200Ω 档
    { mode: 'RES2k',   label: '2kΩ',   angle: 90 },                  // 电阻 2kΩ 档
    { mode: 'RES200k', label: '200kΩ', angle: 120 },                 // 电阻 200kΩ 档
    { mode: 'MA',      label: 'mA',    angle: 150 },                 // 直流电流档
    { mode: 'C',       label: 'uF',    angle: 180 },                 // 电容档
    { mode: 'ACV500',  label: '~500V', angle: 210 },                 // 交流电压 500V
    { mode: 'ACV200',  label: '~200V', angle: 240 },                 // 交流电压 200V
    { mode: 'DCV200',  label: '200V',  angle: 270 },                 // 直流电压 200V
    { mode: 'DCV20',   label: '20V',   angle: 300 },                 // 直流电压 20V
    { mode: 'DCVmv',   label: '200mV', angle: 330 },                 // 直流毫伏档
];

const MODE_INFO = DIAL.reduce((acc, d) => { acc[d.mode] = d; return acc; }, {}); // 档位 → { label, angle } 快查表

export class Multimeter3D extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);                                          // 基类构造：建 Konva group、登记进 sys

        this.width = Math.max(20, config.width || 20);               // Konva 侧尺寸（仅占位，真实模型在 three.js）
        this.height = Math.max(20, config.height || 20);
        this.type = 'multimeter';                                    // 电气类型：求解内核按 12 档注入（stampMultimeters）
        this.cache = false;                                           // Konva 侧永不缓存位图（本组件没有 2D 画面）
        this.group.draggable(false);                                 // 禁止 Konva 拖动（位置由 3D 宿主管理）

        this._initGroups();                                           // 基类标准三组（本组件基本闲置）
        this._recalcGeometry(config);                                 // 规范顺序：由外形尺寸推算 _geo 部件布局表

        // ── 测量状态（移植 2D 版 Multimeter 的字段）──
        this.mode = 'OFF';                                           // 当前档位
        this._lastMode = undefined;                                  // 上一次档位（用于切档时清测量缓冲）
        this.value = 1000000;                                        // 最近一次测量值（内部约定：V / A / Ω / µF）
        this.displayValue = 'O.L';                                   // 屏幕文本
        this._lcd = { value: 'O.L', unit: '', prefix: '' };          // 屏幕三行内容（纹理刷新用）
        this._displayThrottle = 200;                                 // 屏幕刷新节流 200 ms（与 2D 版一致）
        this._lastUpdateAt = 0;
        this._pendingValue = null;
        this._pendingTimer = null;
        this._needleAngle = 0;                                       // 旋钮指针当前角度（度）
        this._needleTarget = 0;                                      // 目标角度（点击切档后平滑转过去）
        this._beeping = false;                                       // 通断蜂鸣状态
        this._beepTimer = null;
        this._beepSeq = 0;
        this._audioCtx = null;
        this._acvBuf = null; this._acvSumSq = 0; this._acvIdx = 0; this._acvCount = 0;   // 交流 RMS 环形缓冲
        this._acCBuf = null; this._acCSumSq = 0; this._acCIdx = 0; this._acCCount = 0;   // 电流 RMS 环形缓冲
        this._capKey = null; this._capDone = false; this._capTimer = 0;                   // 电容档状态
        this._capSimTime = 0; this._capV0 = undefined; this._capIter = undefined; this._capValue = null;
        this._resCV = false;                                         // 电阻/二极管档顺从标志（求解内核读）

        // config 副本（不含尺寸：改尺寸需重建模型，故不进参数框）
        this.config = { hostId: config.hostId };

        this._init();                                                 // 端口注册 + 挂接 3D 宿主
    }

    /* ────────────────────────── 布局推算 ────────────────────────── */

    /** 由外形尺寸推算全部部件位（与 2D 组件 _recalcGeometry 同款范式）
     *  输入：caseW 0.26~0.52 / caseD 0.08~0.22 / caseH 0.14~0.62（米）
     *  输出：_geo —— 外壳/面板/LCD/旋钮/刻度盘/三个插孔 + footprint + 端子 tip
     */
    _recalcGeometry(config) {
        const clamp = (v, lo, hi, dft) => {
            const n = Number(v);
            return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dft;
        };
        const cw = clamp(config.caseW, 0.26, 0.52, 0.36);            // 外壳宽（x）
        const chh = clamp(config.caseH, 0.14, 0.62, 0.48);           // 外壳高（y）：立式表，面板朝前（默认高度已加倍）
        const cd = clamp(config.caseD, 0.08, 0.22, 0.14);            // 外壳厚（z）

        const baseT = 0.016;                                         // 底座厚（贴桌面）
        const baseW = cw + 0.035;                                    // 底座宽（比外壳大一圈，不易翻倒）
        const baseD = cd + 0.045;                                    // 底座深

        const plateT = 0.008;                                        // 面板厚（贴在外壳正面）
        const plateW = cw - 0.024;                                   // 面板宽
        const plateH = chh - 0.024;                                  // 面板高
        const faceZ = cd / 2;                                        // 外壳正面 z
        const plateZ = faceZ + plateT / 2;                           // 面板中心 z
        const faceFront = faceZ + plateT;                            // 面板前表面 z（LCD/旋钮/插孔贴它）

        const lcdW = plateW * 0.66;                                  // LCD 宽
        const lcdH = lcdW * 0.44;                                    // LCD 高（约 2.3:1）
        const lcdY = baseT + chh * 0.74;                             // LCD 中心高（面板上部）
        const lcdZ = faceFront + 0.004;                              // 浮出面板 4mm（否则被屏框盖住、看着全黑）

        const knobR = cw * 0.15;                                     // 旋钮半径
        const knobH = 0.026;                                         // 旋钮厚（沿 z）
        const knobY = baseT + chh * 0.36;                            // 旋钮中心高（面板下部）
        const knobZ = faceFront + knobH / 2;                         // 旋钮贴面板、朝前凸出
        const dialR = knobR * 1.80;                                  // 刻度盘半径

        const sockR = 0.022;                                         // 插孔外环半径
        const sockH = 0.010;                                         // 插孔座厚（沿 z）
        const sockY = baseT + chh * 0.13;                            // 插孔中心高（面板底部）
        const sockX = cw * 0.30;                                     // 左右插孔横向位置
        const jackR = 0.012;                                         // 柱身半径
        const jackH = 0.026;                                         // 柱长（沿 z 朝前伸出，电缆从这里接出）
        const jackZ = faceFront + sockH + jackH / 2;                 // 柱中心 z
        const hitR = 0.040;                                          // 隐形拾取柱半径
        const hitH = 0.070;                                          // 拾取柱长（沿 z，只罩住柱子附近，不拦旋钮）

        this._geo = {
            cw, chh, cd, baseT, baseW, baseD,
            plateT, plateW, plateH, faceZ, plateZ, faceFront,
            lcdW, lcdH, lcdY, lcdZ,
            knobR, knobH, knobY, knobZ, dialR, dialZ: faceFront + 0.0008,
            sockR, sockH, sockY, sockX, jackR, jackH, jackZ, hitR, hitH,
            // 足迹：底座半宽深；顶面 = 外壳顶（结构最高点，电缆逃逸段必须高于它）
            fp: { hx: baseW / 2, hz: baseD / 2, top: baseT + chh + 0.004, escapeY: sockY }, // 足迹：底座半尺寸；top=表顶（结构最高点）；escapeY=插孔柱高→表笔线从插孔水平伸出，不翻过表顶挡住面板
            tip: new THREE.Vector3(0, 0, jackH / 2 + 0.006),         // 端子 tip：柱前端 6mm（沿 +z）
        };
    }

    /* ────────────────────────── 初始化 ────────────────────────── */

    _init() {
        // 端口仅作电气锚点（与 2D 版同名：ma / com / v），坐标由 3D 宿主投影覆盖
        this.addPort(0, 0, 'ma', 'wire', 'p');                       // 电流档插孔（红）
        this.addPort(0, 0, 'com', 'wire', null);                     // 公共端（黑）
        this.addPort(0, 0, 'v', 'wire', 'p');                        // 电压/电阻/电容插孔（红）
        this.ports.forEach(p => {
            if (p.node) { p.node.listening(false); p.node.opacity(0); p.node.radius(2); } // 隐形化
        });

        const hostId = this.config.hostId;                           // 从 config 副本取宿主 id
        const host = (this.sys.comps || {})[hostId];                 // 3D 场景宿主组件
        if (host && typeof host.registerDevice === 'function') host.registerDevice(this);
        else console.warn(`[Multimeter3D ${this.id}] 未找到 3D 宿主组件（hostId=${hostId}）`);
    }

    /* ────────────────────────── 档位操作 ────────────────────────── */

    /** 当前档位标识（如 'DCV20'） */
    getMode() { return this.mode; }

    /** 当前档位刻度文字（如 '20V'） */
    getModeLabel() { return (MODE_INFO[this.mode] || MODE_INFO.OFF).label; }

    /** 设置档位（工作流/自动演示用）：同步指针角度并立即重新测量 */
    setMode(mode) {
        const info = MODE_INFO[mode];
        if (!info) return;                                           // 非法档位忽略
        this.mode = mode;                                            // 记录档位
        this._needleTarget = info.angle;                             // 指针目标角度
        this._resetMeasureBuffers();                                 // 清 ACV/电流/电容缓冲（与 2D 版一致）
        this._measureNow();                                          // 切档后立即用新档位测一次
        if (this._needle) this._needle.rotation.z = -info.angle * Math.PI / 180; // 模型已就绪时瞬移指针
        this._needleAngle = info.angle;
        this._refreshLcd();                                          // 屏幕立刻反映档位
        if (this._host) this._host._invalidate();                     // 请求重绘一帧
    }

    /** 旋钮点一下：顺时针转到下一档（OFF → DIODE → … → DCVmv → OFF） */
    nextMode() {
        const i = DIAL.findIndex(d => d.mode === this.mode);         // 当前档位下标
        const nxt = DIAL[(i + 1) % DIAL.length];                     // 下一个档位（循环）
        this.setMode(nxt.mode);                                      // 应用档位
        return nxt.mode;
    }

    /** 档位变化时清空 RMS/电容缓冲（避免上一档残留数据污染读数） */
    _resetMeasureBuffers() {
        this._lastMode = this.mode;
        if (this.mode.startsWith('ACV')) {
            this._acvBuf = null; this._acvSumSq = 0; this._acvIdx = 0; this._acvCount = 0;
        }
        if (this.mode === 'MA') {
            this._acCBuf = null; this._acCSumSq = 0; this._acCIdx = 0; this._acCCount = 0;
        }
        this._capKey = null; this._capDone = false; this._capTimer = 0;
        this._capSimTime = 0; this._capV0 = undefined; this._capIter = undefined; this._capValue = null;
    }

    /** 切档后绕过显示节流，立即用当前档位真实测一次（与 2D 版 _measureNow 同义） */
    _measureNow() {
        if (this._pendingTimer) { clearTimeout(this._pendingTimer); this._pendingTimer = null; }
        this._pendingValue = null;
        this._lastUpdateAt = 0;
        if (this.mode === 'OFF') { this.update(0); return; }
        if (this.sys && this.sys.voltageSolver) this.tick(0);
    }

    /* ────────────────────────── 测量与显示 ────────────────────────── */

    /** 表笔悬空判定：v/com 所在节点簇只有自己 → 视为悬空（与 2D 版一致） */
    _probesFloating(s) {
        if (!s || !s.portToCluster) return false;
        const count = new Map();
        for (const c of s.portToCluster.values()) count.set(c, (count.get(c) || 0) + 1);
        const wired = (pid) => {
            const c = s.portToCluster.get(pid);
            return c !== undefined && (count.get(c) || 0) >= 2;
        };
        return !wired(`${this.id}_wire_v`) || !wired(`${this.id}_wire_com`);
    }

    /** 电阻档：恒流注入 → R = 端口电压 / 档位测试电流 */
    _updateRES(s) {
        const vPort = Math.abs(s.getPD(`${this.id}_wire_v`, `${this.id}_wire_com`) || 0);
        let iSet = 0.001;                                            // RES200：1mA
        if (this.mode === 'RES2k') iSet = 0.0001;                    // RES2k：0.1mA
        else if (this.mode === 'RES200k') iSet = 0.000001;           // RES200k：1µA
        const R = vPort / iSet;
        this.update(!isFinite(R) || R >= 1e9 ? 1000000 : R);
    }

    /** 二极管/通断档：显示管压降或导通电阻 */
    _updateDiode(s) {
        const vPort = Math.abs(s.getPD(`${this.id}_wire_v`, `${this.id}_wire_com`) || 0);
        this.update(vPort);
    }

    /** 交流电压档：40 点环形缓冲求 RMS */
    _updateACV(s) {
        const vDiff = s.getPD(`${this.id}_wire_v`, `${this.id}_wire_com`);
        if (!this._acvBuf) { this._acvBuf = new Float64Array(40); this._acvSumSq = 0; this._acvIdx = 0; this._acvCount = 0; }
        const buf = this._acvBuf;
        const idx = this._acvIdx;
        this._acvSumSq -= buf[idx];
        const sq = Number.isFinite(vDiff) ? vDiff * vDiff : 0;       // 求解异常值按 0 处理，避免永久 O.L
        buf[idx] = sq;
        this._acvSumSq += sq;
        this._acvIdx = (idx + 1) % buf.length;
        if (this._acvCount < buf.length) this._acvCount++;
        const rms = this._acvCount > 0 ? Math.sqrt(Math.max(0, this._acvSumSq) / this._acvCount) : 0;
        this.update(rms < 0.01 ? 0 : rms);
    }

    /** 电流档：求解内核把 (vMa−vCom)/0.2 回填到 physCurrent，这里做 40 点 RMS 平滑 */
    _updateMACurrent(s) {
        const current = this.physCurrent || 0;
        if (!this._acCBuf) { this._acCBuf = new Float64Array(40); this._acCSumSq = 0; this._acCIdx = 0; this._acCCount = 0; }
        const buf = this._acCBuf;
        const idx = this._acCIdx;
        this._acCSumSq -= buf[idx];
        const sq = Number.isFinite(current) ? current * current : 0;
        buf[idx] = sq;
        this._acCSumSq += sq;
        this._acCIdx = (idx + 1) % buf.length;
        if (this._acCCount < buf.length) this._acCCount++;
        const rms = this._acCCount > 0 ? Math.sqrt(Math.max(0, this._acCSumSq) / this._acCCount) : 0;
        this.update(rms * 1000);                                     // 内部约定 mA
    }

    /** 电容档：1mA 恒流充电 3s，C = I·t/ΔV（与 2D 版一致，含表笔换位重测） */
    _updateCapacitance(s, dt) {
        const CAP_CURRENT = 0.001;
        const CAP_TIME = 3.0;
        const cV = s.portToCluster.get(`${this.id}_wire_v`);
        const cCOM = s.portToCluster.get(`${this.id}_wire_com`);
        if (cV === undefined || cCOM === undefined) {
            this._capKey = null; this._capDone = false;
            this.update(1000000);                                    // 未接线 → O.L
            return;
        }
        const key = `${cV}|${cCOM}`;
        const v = s.getPD(`${this.id}_wire_v`, `${this.id}_wire_com`) || 0;
        if (this._capKey !== key) {                                   // 表笔接入点变了 → 重新测
            this._capKey = key; this._capDone = false; this._capTimer = 0; this._capSimTime = 0;
            this._capV0 = v; this._capIter = s.globalIterCount; this._capValue = null;
        }
        if (this._capDone) {
            if (this._capValue != null) this.update(this._capValue);
            return;
        }
        if (this._capIter === undefined) this._capIter = s.globalIterCount;
        if (s.globalIterCount !== this._capIter) {                    // 累加求解器实际推进的仿真时间
            this._capSimTime += s.deltaTime * (s.globalIterCount - this._capIter);
            this._capIter = s.globalIterCount;
        }
        this._capTimer += dt;
        if (this._capTimer < CAP_TIME) return;                        // 充电中，暂不刷新
        const dV = Math.abs(v - this._capV0);
        if (this._capSimTime <= 0 || dV < 1e-9) {
            this._capValue = 1000000;                                  // 短路或超量程
        } else {
            const cUF = CAP_CURRENT * this._capSimTime / dV * 1e6;
            this._capValue = (!isFinite(cUF) || cUF > 1e6) ? 1000000 : cUF;
        }
        this._capDone = true;                                         // 测完停止充电，保持读数
        this.update(this._capValue);
    }

    /** 每帧测量分派（与 2D 版 tick 完全同构） */
    tick(dt) {
        const s = this.sys && this.sys.voltageSolver;
        if (!s) return;
        const mode = this.mode || 'OFF';
        if (mode === 'OFF') { this._animateNeedle(dt); return; }      // 关机：只跑旋钮动画
        if (mode.startsWith('DCV')) {
            this.update(s.getPD(`${this.id}_wire_v`, `${this.id}_wire_com`) || 0);
        } else if (mode === 'MA') {
            this._updateMACurrent(s);
        } else if (mode.startsWith('RES')) {
            if (this._probesFloating(s)) this.update(1000000); else this._updateRES(s);
        } else if (mode === 'DIODE') {
            if (this._probesFloating(s)) this.update(1000000); else this._updateDiode(s);
        } else if (mode === 'C') {
            this._updateCapacitance(s, dt);
        } else if (mode.startsWith('ACV')) {
            this._updateACV(s);
        }
        this._animateNeedle(dt);                                      // 旋钮指针平滑转动
    }

    /** 旋钮指针向目标角度插值（点击切档后可见"旋钮转过去"） */
    _animateNeedle(dt) {
        if (!this._needle) return;
        const d = this._needleTarget - this._needleAngle;
        if (Math.abs(d) < 0.05) {
            if (d !== 0) { this._needleAngle = this._needleTarget; this._needle.rotation.z = -this._needleAngle * Math.PI / 180; if (this._host) this._host._invalidate(); }
            return;
        }
        this._needleAngle += d * Math.min(1, (dt || 0.05) * 12);
        this._needle.rotation.z = -this._needleAngle * Math.PI / 180;
        if (this._host) this._host._invalidate();
    }

    /** 接收测量值 → 格式化（单位/精度/O.L）→ 刷新 LCD 纹理（节流 200ms） */
    update(val) {
        if (val == null || isNaN(val)) val = 1000000;
        this.value = val;

        const now = performance.now();
        const elapsed = now - (this._lastUpdateAt || 0);
        if (elapsed < this._displayThrottle) {                        // 节流：合并高频更新
            this._pendingValue = val;
            if (!this._pendingTimer) {
                const wait = Math.max(1, this._displayThrottle - elapsed);
                this._pendingTimer = setTimeout(() => {
                    this._pendingTimer = null;
                    if (this._pendingValue == null) return;
                    try { this.update(this._pendingValue); } catch (e) { }
                }, wait);
            }
            return;
        }
        this._lastUpdateAt = now;
        if (this._pendingTimer) { clearTimeout(this._pendingTimer); this._pendingTimer = null; }
        this._pendingValue = null;

        if (this.mode === 'OFF') {                                    // 关机：屏幕清空、蜂鸣停
            this._lcd = { value: '', unit: '', prefix: '', dim: true };
            this._refreshLcd();
            this.triggerBeep(false);
            return;
        }

        let display = this.value;
        let unit = '';
        let prefix = 'DC';
        let precision = 3;
        let isOverload = false;

        switch (this.mode) {
            case 'DCVmv':                                            // 直流毫伏：内部以 V 存
                unit = 'mV'; prefix = 'DC'; precision = 1;
                display = display * 1000;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'DCV20':
                unit = 'V'; prefix = 'DC'; precision = 2;
                if (Math.abs(display) > 20) isOverload = true;
                break;
            case 'DCV200':
                unit = 'V'; prefix = 'DC'; precision = 1;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'ACV200':
                unit = 'V'; prefix = 'AC'; precision = 1;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'ACV500':
                unit = 'V'; prefix = 'AC'; precision = 0;
                if (Math.abs(display) > 500) isOverload = true;
                break;
            case 'DIODE':                                            // 通断：<0.3V 按 1mA 折算电阻，<5Ω 蜂鸣
                if (display < 0.3) {
                    display = display * 1000;
                    unit = 'Ω'; prefix = ''; precision = 2;
                    this.triggerBeep(display < 5);
                    if (display > 200) isOverload = true;
                } else {
                    this.triggerBeep(false);
                    unit = 'V'; prefix = '▶|'; precision = 3;
                    if (display > 3) isOverload = true;
                }
                break;
            case 'RES200':
                unit = 'Ω'; prefix = ''; precision = 2;
                if (display > 200) isOverload = true;
                break;
            case 'RES2k':
                unit = 'kΩ'; prefix = ''; precision = 3;
                display = display / 1000;
                if (display > 2) isOverload = true;
                break;
            case 'RES200k':
                unit = 'kΩ'; prefix = ''; precision = 1;
                display = display / 1000;
                if (display > 200) isOverload = true;
                break;
            case 'MA':                                               // 电流：自动换 uA/mA/A
                if (Math.abs(display) < 0.1) { unit = 'uA'; display = display * 1000; }
                else if (Math.abs(display) > 100) { unit = 'A'; display = display / 1000; }
                else { unit = 'mA'; }
                prefix = 'DC'; precision = 2;
                if (display > 100) isOverload = true;
                break;
            case 'C':
                unit = 'uF'; prefix = 'CAP'; precision = 2;
                if (display > 200) isOverload = true;
                break;
            default:
                break;
        }

        const text = isOverload ? 'O.L' : display.toFixed(precision);
        const changed = text !== this._lcd.value || unit !== this._lcd.unit
            || prefix !== this._lcd.prefix || !!isOverload !== !!this._lcd.overload;
        this._lcd = { value: text, unit, prefix, overload: isOverload, dim: false };
        this.displayValue = text;
        if (changed) this._refreshLcd();                              // 内容变化才重绘纹理（省 CPU）
    }

    /** 通断蜂鸣：短 3 声（2500Hz/130ms），与 2D 版一致 */
    triggerBeep(on) {
        if (on === this._beeping) return;
        this._beeping = !!on;
        if (!on) { this._stopBeep(); return; }
        this._beepSeq = 0;
        this._playBeep();
    }

    _playBeep() {
        if (this._beepSeq >= 3) { this._beeping = false; return; }
        try {
            if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this._audioCtx.state === 'suspended') this._audioCtx.resume().catch(() => { });
            const osc = this._audioCtx.createOscillator();
            const gain = this._audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2500, this._audioCtx.currentTime);
            gain.gain.setValueAtTime(0.10, this._audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(this._audioCtx.destination);
            osc.start();
            setTimeout(() => { try { osc.stop(); osc.disconnect(); gain.disconnect(); } catch (e) { } }, 130);
        } catch (e) { }
        this._beepSeq++;
        this._beepTimer = setTimeout(() => this._playBeep(), 220);
    }

    _stopBeep() {
        if (this._beepTimer) { clearTimeout(this._beepTimer); this._beepTimer = null; }
        this._beepSeq = 0;
    }

    /* ────────────────────────── 3D 建模 ────────────────────────── */

    /** LCD 贴图：黑底绿字，画布 640×256（内容清空按钮式重绘，纹理复用） */
    _drawLcdTexture() {
        const cv = document.createElement('canvas');
        cv.width = 640; cv.height = 256;
        this._lcdCanvas = cv;
        this._lcdCtx = cv.getContext('2d');
        const tex = new THREE.CanvasTexture(cv);
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._lcdTex = tex;
        this._paintLcd();
        return tex;
    }

    /** 把 _lcd 内容画到画布（数值大字 + 左上角档位 + 右侧单位 + 底部量程条装饰） */
    _paintLcd() {
        const ctx = this._lcdCtx;
        if (!ctx) return;
        const W = 640, H = 256;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0a1512';                                    // LCD 底色（深墨绿）
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#1d3a2c';                                  // 边框
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, W - 8, H - 8);

        const L = this._lcd || { value: '', unit: '', prefix: '' };
        if (L.dim) return;                                            // 关机：只留底色

        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8ef7ae';                                    // 荧光绿
        ctx.font = 'bold 46px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(L.prefix || '', 34, 52);                         // 左上：DC / AC / CAP / ▶|

        ctx.textAlign = 'right';
        ctx.font = 'bold 40px monospace';
        ctx.fillText(L.unit || '', W - 34, 56);                       // 右上：单位

        ctx.textAlign = 'right';
        ctx.font = 'bold 132px monospace';                            // 主数值：大号右对齐
        ctx.fillStyle = L.overload ? '#ff9a5c' : '#9dffbc';           // 溢出 O.L 用橙红警示
        ctx.fillText(L.value || '', W - 34, H * 0.58);

        ctx.fillStyle = '#3f7a5c';                                    // 底部量程装饰条
        for (let i = 0; i < 16; i++) ctx.fillRect(36 + i * 36, H - 30, 20, 6);
        if (this._lcdTex) this._lcdTex.needsUpdate = true;             // 通知 three 重新上传纹理
    }

    /** 刷新屏幕（仅在内容变化时被调用） */
    _refreshLcd() {
        this._paintLcd();
        if (this._host) this._host._invalidate();                     // 请求渲染一帧
    }

    /** 刻度盘贴图：12 档文字环绕，0° 在顶部、顺时针排布 */
    _drawDialTexture() {
        const cv = document.createElement('canvas');
        cv.width = 512; cv.height = 512;
        const ctx = cv.getContext('2d');
        const cx = 256, cy = 256;
        for (const d of DIAL) {
            const a = d.angle * Math.PI / 180;                        // 0°=顶，顺时针为正
            const x = cx + Math.sin(a) * 200;                         // 极坐标 → 画布坐标
            const y = cy - Math.cos(a) * 200;
            ctx.strokeStyle = d.mode === 'OFF' ? '#9fb4c9' : '#8b98a8'; // 刻度短线
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(cx + Math.sin(a) * 168, cy - Math.cos(a) * 168);
            ctx.lineTo(cx + Math.sin(a) * 186, cy - Math.cos(a) * 186);
            ctx.stroke();
            ctx.fillStyle = d.mode === 'OFF' ? '#dfe9f3' : '#c2ccd8';  // 档位文字
            ctx.font = 'bold 26px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.label, x, y);
        }
        ctx.fillStyle = '#8b98a8';                                    // 中心小圆（被旋钮盖住，装饰）
        ctx.beginPath();
        ctx.arc(cx, cy, 60, 0, Math.PI * 2);
        ctx.fill();
        const tex = new THREE.CanvasTexture(cv);
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        return tex;
    }

    /** 构建 3D 模型（宿主 Circuit3DScene.registerDevice 调用） */
    buildThree() {
        const g = this._geo;
        const root = new THREE.Group();
        root.position.set(WORLD.mmX, WORLD.tableTop, WORLD.mmZ);      // 世界坐标：桌面右前

        const caseMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.68, metalness: 0.18 }); // 外壳：深灰塑料
        const plateMat = new THREE.MeshStandardMaterial({ color: 0x3d444e, roughness: 0.55, metalness: 0.12 }); // 面板：浅一档灰
        const knobMat = new THREE.MeshStandardMaterial({ color: 0x191d22, roughness: 0.45, metalness: 0.35 }); // 旋钮：近黑
        const brass = new THREE.MeshStandardMaterial({ color: 0xcfa64b, roughness: 0.35, metalness: 0.85 });   // 黄铜接线柱

        const base = new THREE.Mesh(new THREE.BoxGeometry(g.baseW, g.baseT, g.baseD), caseMat); // 底座（贴桌，比外壳大一圈不易翻倒）
        base.position.y = g.baseT / 2;
        base.castShadow = true; base.receiveShadow = true;
        root.add(base);

        const body = new THREE.Mesh(new THREE.BoxGeometry(g.cw, g.chh, g.cd), caseMat);  // 外壳（立式：面板朝前 +z）
        body.position.y = g.baseT + g.chh / 2;                         // 立在底座上
        body.castShadow = true; body.receiveShadow = true;
        root.add(body);

        const plate = new THREE.Mesh(new THREE.BoxGeometry(g.plateW, g.plateH, g.plateT), plateMat); // 面板（外壳正面）
        plate.position.set(0, g.baseT + g.chh / 2, g.plateZ);
        plate.receiveShadow = true;
        root.add(plate);

        // ── LCD：深色屏框 + 贴图面（实时刷新；浮出面板 4mm，否则被屏框遮黑）──
        const bezel = new THREE.Mesh(                                   // 屏框（嵌进面板，前面与面板齐平）
            new THREE.BoxGeometry(g.lcdW + 0.022, g.lcdH + 0.022, 0.010),
            new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.7 })
        );
        bezel.position.set(0, g.lcdY, g.faceZ + 0.003);
        root.add(bezel);

        const lcdMesh = new THREE.Mesh(                                 // 显示屏（发贴图）
            new THREE.PlaneGeometry(g.lcdW, g.lcdH),
            new THREE.MeshBasicMaterial({ map: this._drawLcdTexture(), toneMapped: false }) // 不受光照影响：像自发光屏
        );
        lcdMesh.position.set(0, g.lcdY, g.lcdZ);                        // 默认朝向 +z（正对观察者）
        root.add(lcdMesh);
        this._lcdMesh = lcdMesh;

        // ── 刻度盘 + 旋钮（沿 z 凸出，指针绕 z 轴转）──
        const dial = new THREE.Mesh(                                    // 刻度盘贴图（竖面，贴面板）
            new THREE.PlaneGeometry(g.dialR * 2, g.dialR * 2),
            new THREE.MeshBasicMaterial({ map: this._drawDialTexture(), transparent: true, toneMapped: false })
        );
        dial.position.set(0, g.knobY, g.dialZ);
        root.add(dial);

        const knob = new THREE.Mesh(new THREE.CylinderGeometry(g.knobR, g.knobR * 1.06, g.knobH, 36), knobMat);
        knob.rotation.x = Math.PI / 2;                                  // 圆柱轴 y → z：旋钮朝前凸出
        knob.position.set(0, g.knobY, g.knobZ);
        knob.castShadow = true;
        root.add(knob);

        const cap = new THREE.Mesh(                                     // 旋钮顶盖（略亮，增强立体感）
            new THREE.CylinderGeometry(g.knobR * 0.86, g.knobR * 0.9, 0.006, 36),
            new THREE.MeshStandardMaterial({ color: 0x2c333c, roughness: 0.4, metalness: 0.4 })
        );
        cap.rotation.x = Math.PI / 2;
        cap.position.set(0, g.knobY, g.knobZ + g.knobH / 2 + 0.003);
        root.add(cap);

        const needle = new THREE.Group();                               // 指针组：绕 z 轴转（正面看即顺时针）
        needle.position.set(0, g.knobY, g.knobZ + g.knobH / 2 + 0.007);
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.007, g.knobR * 0.78, 0.004),          // 细长条：沿 +y 指向刻度
            new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.35, metalness: 0.2 })
        );
        blade.position.set(0, g.knobR * 0.42, 0);                       // 顶端伸出旋钮边缘
        needle.add(blade);
        root.add(needle);
        this._needle = needle;
        needle.rotation.z = -this._needleTarget * Math.PI / 180;         // 档位角顺时针为正 → 绕 z 负转

        const knobHit = new THREE.Mesh(                                 // 旋钮拾取柱（透明，只罩住旋钮前方）
            new THREE.CylinderGeometry(g.knobR * 1.25, g.knobR * 1.25, 0.10, 16),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        knobHit.rotation.x = Math.PI / 2;
        knobHit.position.set(0, g.knobY, g.faceFront + g.knobH + 0.05);  // 悬在旋钮前方
        knobHit.userData = { kind: 'knob', comp: this, visual: knob };  // 宿主据此识别“旋钮点击 → 切档”
        root.add(knobHit);

        // ── 三个插孔（ma / com / v）+ 接线柱 + 隐形拾取柱（沿 z 朝前伸出）──
        const mkJack = (x, ringColor, port) => {
            const ring = new THREE.Mesh(                                // 插孔外环（红/黑）
                new THREE.CylinderGeometry(g.sockR, g.sockR, g.sockH, 24),
                new THREE.MeshStandardMaterial({ color: ringColor, roughness: 0.5, metalness: 0.2 })
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.set(x, g.sockY, g.faceFront + g.sockH / 2);
            root.add(ring);

            const hole = new THREE.Mesh(                                // 孔（深色，视觉上是插口）
                new THREE.CylinderGeometry(g.jackR * 0.82, g.jackR * 0.82, g.sockH + 0.004, 20),
                new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.9 })
            );
            hole.rotation.x = Math.PI / 2;
            hole.position.set(x, g.sockY, g.faceFront + g.sockH / 2 + 0.001);
            root.add(hole);

            const jack = new THREE.Mesh(                                // 接线柱（黄铜）：电缆从这里接出
                new THREE.CylinderGeometry(g.jackR, g.jackR, g.jackH, 20), brass.clone()
            );
            jack.rotation.x = Math.PI / 2;
            jack.position.set(x, g.sockY, g.jackZ);
            jack.castShadow = true;
            root.add(jack);

            const hit = new THREE.Mesh(                                 // 隐形拾取柱
                new THREE.CylinderGeometry(g.hitR, g.hitR, g.hitH, 12),
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
            );
            hit.rotation.x = Math.PI / 2;
            hit.position.set(x, g.sockY, g.jackZ);
            root.add(hit);
            return { jack, hit, port };
        };

        const jMa = mkJack(-g.sockX, 0xd23b2f, 'ma');                   // 左：mA（红）
        const jCom = mkJack(0, 0x22262b, 'com');                        // 中：COM（黑）
        const jV = mkJack(g.sockX, 0xd23b2f, 'v');                      // 右：V/Ω（红）

        // 插孔文字标签（mA / COM / V）：贴在插孔下方的面板上，朝 +z
        [[-g.sockX, 'mA'], [0, 'COM'], [g.sockX, 'V']].forEach(([x, text]) => {
            const tex = makeLabelTexture(text);
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(0.075, 0.024),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
            );
            m.position.set(x, g.sockY - g.sockR - 0.017, g.faceFront + 0.0015);
            root.add(m);
        });

        return {
            root,
            footprint: g.fp,                                            // 足迹：电缆逃逸用
            terminals: [
                { port: 'ma', mesh: jMa.jack, hit: jMa.hit, tip: g.tip.clone() },
                { port: 'com', mesh: jCom.jack, hit: jCom.hit, tip: g.tip.clone() },
                { port: 'v', mesh: jV.jack, hit: jV.hit, tip: g.tip.clone() },
            ],
            pickables: [knobHit],                                       // 旋钮：点击切档
        };
    }

    destroy() {
        this._stopBeep();                                              // 停蜂鸣定时器
        if (this._audioCtx) { try { this._audioCtx.close(); } catch (e) { } this._audioCtx = null; }
        if (this._lcdTex) { try { this._lcdTex.dispose(); } catch (e) { } }
    }
}

/** 插孔文字小贴图（透明底白字），供 buildThree 内部使用 */
function makeLabelTexture(text) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 82;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.font = 'bold 58px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d8e2ec';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}
