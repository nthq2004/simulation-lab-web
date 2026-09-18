/**
 * DiagramThreePhaseACB 三相空气断路器示意组件。
 *
 * 作用：这是一个用于仿真平台中的三相空气断路器（ACB）图形元件，承担断路器的开合、过流脱扣和状态显示等教学功能。
 * 它在三相供电系统中，用于模拟断路器的通断动作，并在过流超过设定值时触发跳闸状态，
 * 同时保留手动操作和参数配置功能，适合做电力系统保护教学演示。
 *
 * 设计特点：
 * 1. 三相并列结构，分别对应 L1/L2/L3 与 T1/T2/T3；
 * 2. 通过刀片角度动画模拟断路器机械闭合/分断；
 * 3. 采用 RMS 电流计算并在超过保护阈值时执行 trip；
 * 4. 支持配置额定值、动作时间和初始状态，便于仿真实验扩展。
 */
import { BaseComponent } from './BaseComponent.js';

export class DiagramThreePhaseACB extends BaseComponent {
    constructor(config, sys) {
        // 调用父类构造函数，初始化基础组件能力和系统对象引用。
        super(config, sys);

        // 组件尺寸按至少 120×90 处理，允许调用时通过配置调整外观。
        this.width  = Math.max(120, config.width  || 150);
        this.height = Math.max(90,  config.height || 120);

        // 组件类型声明为 ACB，并标记为三相空气断路器类型。
        this.type    = 'ACB';
        this.special = '3P-ACB';
        // 采用固定缓存，以减少整块图形频繁重绘。
        this.cache   = 'fixed';

        // 按顺序初始化图层和组件状态。
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // 配置对象用于保存该断路器的关键参数和当前状态。
        this.config = {
            id: this.id,
            label:        this.label,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            tripCurrent:  this.tripCurrent,
            initState:    this._state,
            animDur:      this._animDur,
            tripCoilR:    this._tripCoilR,
        };

        // 端口按三相输入和输出分布，分别连接 L1/L2/L3 与 T1/T2/T3。
        this.addPort(this._portL[0].x, this._portL[0].y, 'l1', 'wire');
        this.addPort(this._portL[1].x, this._portL[1].y, 'l2', 'wire');
        this.addPort(this._portL[2].x, this._portL[2].y, 'l3', 'wire');
        this.addPort(this._portT[0].x, this._portT[0].y, 't1', 'wire', 'p');
        this.addPort(this._portT[1].x, this._portT[1].y, 't2', 'wire', 'p');
        this.addPort(this._portT[2].x, this._portT[2].y, 't3', 'wire', 'p');
        // this.addPort(this._portFla.x, this._portFla.y, 'fla', 'wire');
        // this.addPort(this._portFlb.x, this._portFlb.y, 'flb', 'wire');
    }

    _recalcGeometry() {
        // 计算断路器的基准几何参数，包括边框、每相位置和触点分布。
        const W = this.width, H = this.height;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 4 };

        const rPad = 3;
        const coilW = 20;
        const availW = W - rPad - coilW;

        this._poleXs = Array.from({ length: 3 }, (_, i) =>
            rPad + availW * (i + 0.45) / 3
        );

        this._lineInY  = H * 0.18;
        this._lineOutY = H * 0.82;
        // 上下静触点间距缩至原 2/3（对称分布于组件中心）
        this._bladeLen = H * 0.44 * 2 / 3;
        this._contactInY = (H - this._bladeLen) / 2;
        this._contactOutY = (H + this._bladeLen) / 2;
        this._contactR = Math.max(3, W * 0.018);

        this._bladeLen = this._contactOutY - this._contactInY;

        this._bladeAngles = {
            on:   0,
            off:  -45,
            trip: -22.5,
        };

        this._xSize = Math.max(5, W * 0.035);

        this._portL = this._poleXs.map(px => ({ x: px, y: 2 }));
        this._portT = this._poleXs.map(px => ({ x: px, y: H - 2 }));
        this._portFla = { x: W - 2, y: H * 0.32 };
        this._portFlb = { x: W - 2, y: H * 0.68 };

        this._labelPos = { x: 0, y: -16, w: W };
    }

    _initParameters(config) {
        // 初始化断路器参数，包括额定电压、电流、脱扣倍数和默认状态。
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 380;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 100;
        this.tripCurrent  = config.tripCurrent  !== undefined ? config.tripCurrent  : 10;
        this.label        = config.label        || 'QF';
        this.function     = config.function     || '三相空气断路器';

        const initState = (config.initState || 'off').toLowerCase();
        this._state       = ['on', 'off', 'trip'].includes(initState) ? initState : 'off';
        this._prevState   = this._state;

        this._animating   = false;
        this._animT       = 0;
        this._animFromAng = this._bladeAngles[this._state];
        this._animToAng   = this._bladeAngles[this._state];
        this._curBladeAng = this._bladeAngles[this._state];

        this._animDur       = config.animDur !== undefined ? config.animDur : 0.10;
        this._animJustEnded = false;

        this._iBuf = [new Array(40).fill(0), new Array(40).fill(0), new Array(40).fill(0)];
        this._iBufSum = [0, 0, 0];
        this._iBufIdx = 0;
        this._iBufCount = 0;
        this._iRms = [0, 0, 0];

        this.opsCount = config.initOps || 0;
        this._tripCoilR = config.tripCoilR !== undefined ? config.tripCoilR : 50;
    }

    _init() {
        // 初始化断路器的静态图形、动态刀片和交互行为。
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        // 断路器的静态视觉由外框、三相示意和脱扣线圈共同构成。
        this._drawFrame();
        this._drawSchematicStatic();
        this._drawTripCoil();
    }

    _drawFrame() {
        // 外框提供清晰的断路器边界，方便整体识别和放置。
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f5f6f8',
            stroke: '#9098a8',
            strokeWidth: 1.2,
            cornerRadius: f.rx,
        }));
    }

    _drawSchematicStatic() {
        // 每一相都绘制极柱、静触点和端子标签，表示三相电源的通断关系。
        this._poleXs.forEach((px, i) => {
            const poleName = ['L1', 'L2', 'L3'][i];
            const outName  = ['T1', 'T2', 'T3'][i];
            const color    = ['#e03030', '#20a030', '#2050e0'][i];
            const txOff    = this._contactR + 3;

            this._staticGroup.add(new Konva.Line({
                points: [px, 2, px, this._contactInY],
                stroke: color, strokeWidth: 2,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [px, this._contactOutY, px, this.height - 2],
                stroke: color, strokeWidth: 2,
            }));

            this._staticGroup.add(new Konva.Circle({
                x: px, y: this._contactOutY,
                radius: this._contactR,
                fill: '#e8c86a', stroke: color, strokeWidth: 1.5,
            }));

            this._drawXSymbolOnContact(px, this._contactInY, color);

            this._staticGroup.add(new Konva.Text({
                x: px + txOff, y: this._contactInY - 7,
                text: poleName, fontSize: 12, fontStyle: 'bold', fill: color,
            }));
            this._staticGroup.add(new Konva.Text({
                x: px + txOff, y: this._contactOutY - 7,
                text: outName, fontSize: 12, fontStyle: 'bold', fill: color,
            }));
        });
    }

    _drawXSymbolOnContact(px, y, color) {
        // 在静触点附近加上 X 形符号，表示该位置为断路器的触点区。
        const hs = this._xSize * 0.5;
        this._staticGroup.add(new Konva.Line({
            points: [px - hs, y - hs, px + hs, y + hs],
            stroke: color, strokeWidth: 2.4,
            listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px - hs, y + hs, px + hs, y - hs],
            stroke: color, strokeWidth: 2.4,
            listening: false,
        }));
    }

    _drawTripCoil() {
        // 脱扣线圈的视觉描绘当前被注释掉，说明当前版本中该部分仍保留为扩展接口。
        // const W = this.width, H = this.height;
        // const coilCX = this._portFla.x - 16;
        // const coilTop = this._portFla.y + 5;
        // const coilBot = this._portFlb.y - 5;
        // const coilH = coilBot - coilTop;
        // const halfW = Math.max(4, W * 0.035);
        // const loops = 5;

        // const pts = [];
        // const steps = loops * 16;
        // for (let i = 0; i <= steps; i++) {
        //     const t = i / steps;
        //     const y = coilTop + t * coilH;
        //     const x = coilCX + halfW * Math.cos(t * loops * Math.PI * 2);
        //     pts.push(x, y);
        // }
        // this._staticGroup.add(new Konva.Line({
        //     points: pts,
        //     stroke: '#4a3828', strokeWidth: 1.2,
        //     tension: 0.3, listening: false,
        // }));

        // this._staticGroup.add(new Konva.Line({
        //     points: [coilCX + halfW, coilTop, this._portFla.x, this._portFla.y],
        //     stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        // }));
        // this._staticGroup.add(new Konva.Line({
        //     points: [coilCX + halfW, coilBot, this._portFlb.x, this._portFlb.y],
        //     stroke: '#6a5a28', strokeWidth: 1.5, listening: false,
        // }));
    }

    _createDynamicNodes() {
        // 动态节点用于更新刀片旋转和接触通断状态。
        this._createBladeGroups();
    }

    _createBladeGroups() {
        // 每相生成一个独立刀片组，分别控制各相断路器触头摆动情况。
        this._bladeGroups = this._poleXs.map((px, i) => {
            const color = ['#e03030', '#20a030', '#2050e0'][i];
            const g = new Konva.Group({
                x: px,
                y: this._contactOutY,
                rotation: this._curBladeAng,
            });

            g.add(new Konva.Line({
                points: [0, 0, 0, -this._bladeLen],
                stroke: color, strokeWidth: Math.max(2.5, this.width * 0.016),
                lineCap: 'round',
                listening: false,
            }));

            g.add(new Konva.Circle({
                x: 0, y: 0,
                radius: this._contactR * 1.4,
                fill: '#e8c86a',
                stroke: color, strokeWidth: 1.5,
                listening: false,
            }));

            this._dynamicGroup.add(g);
            return g;
        });

        this._contactGlows = this._poleXs.map((px, i) => {
            // 接触发光效果在闭合状态下可见，反映三相断路器已接通。
            const glows = [];
            [this._contactInY, this._contactOutY].forEach(cy => {
                const g = new Konva.Circle({
                    x: px, y: cy,
                    radius: this._contactR * 2.2,
                    fill: 'rgba(80,220,80,0.30)',
                    visible: this._state === 'on',
                    listening: false,
                });
                this._dynamicGroup.add(g);
                glows.push(g);
            });
            return glows;
        });
    }

    _updateDynamic() {
        // 每帧同步刀片旋转角度，并根据状态决定是否显示接触发光。
        this._bladeGroups.forEach(g => g.rotation(this._curBladeAng));

        const closed = !this._animating && this._state === 'on';
        this._contactGlows.forEach(glows => {
            glows.forEach(g => g.visible(closed));
        });
    }

    _bindInteraction() {
        // 为触头摆动带绑定点击事件，允许用户直接切换开合状态。
        const W = this.width;
        const tR = this._contactR;
        const bandY = this._contactInY - tR;
        const bandH = (this._contactOutY - this._contactInY) + tR * 2;

        const hitArea = new Konva.Rect({
            x: 2,
            y: bandY,
            width: W - 4,
            height: bandH,
            fill: 'transparent',
        });

        hitArea.on('click tap', (e) => {
            // 点击触发时，根据当前状态进行合闸、分闸或复位操作。
            if (this._animating) return;
            if (e.evt?.button !== 0) return;
            const stage = this.group.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;

            const tr = this.group.getTransform().copy();
            tr.invert();
            const local = tr.point(pointer);

            const dy = local.y - this.height / 2;
            if (this._state === 'off') {
                this.close();
            } else if (this._state === 'on') {
                this.open();
            } else if (this._state === 'trip') {
                this._resetToOff();
            }
        });

        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

        this._interactGroup.add(hitArea);
    }

    tick(dt) {
        // 仿真循环中依次更新动画、RMS 电流和过流跳闸判断。
        this._tickAnimation(dt);
        this._updateRMS();
        this._checkOvercurrentTrip();

        if (this._animating || this._animJustEnded) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    _tickAnimation(dt) {
        // 动画按照时间进度进行插值，形成平滑开合动作。
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT         = 1;
            this._animating     = false;
            this._animJustEnded = true;
            this._curBladeAng   = this._animToAng;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._curBladeAng = this._animFromAng + (this._animToAng - this._animFromAng) * ease;
    }

    _updateRMS() {
        // 通过滑动窗口计算各相电流的 RMS，用于后续过流判断。
        const pc = this.phaseCurrents;
        if (!pc) return;
        const inst = [pc.l1 || 0, pc.l2 || 0, pc.l3 || 0];
        for (let i = 0; i < 3; i++) {
            const i2 = inst[i] * inst[i];
            const old = this._iBuf[i][this._iBufIdx];
            this._iBuf[i][this._iBufIdx] = i2;
            this._iBufSum[i] = this._iBufSum[i] - old + i2;
        }
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;
        if (this._iBufCount >= 40) {
            for (let i = 0; i < 3; i++) {
                this._iRms[i] = Math.sqrt(this._iBufSum[i] / 40);
            }
        }
    }

    _checkOvercurrentTrip() {
        // 如果断路器处于合闸状态且任一相 RMS 电流超过阈值，则触发 trip。
        if (this._state !== 'on') return;
        if (this._iBufCount < 40) return;
        const threshold = this.tripCurrent * this.ratedCurrent;
        for (let i = 0; i < 3; i++) {
            if (this._iRms[i] > threshold) {
                this.trip();
                return;
            }
        }
    }

    _startAnim(toState) {
        // 统一启动动画逻辑，记录起始角度、目标角度和状态切换。
        this._animFromAng  = this._curBladeAng;
        this._animToAng    = this._bladeAngles[toState];
        this._animT        = 0;
        this._animating    = true;
        this._state        = toState;
        this.opsCount++;
    }

    _resetToOff() {
        // 从 trip 状态恢复到 off 状态，通常用于复位操作。
        this._animDur = 0.15;
        this._startAnim('off');
    }

    close() {
        // 只有在 off 状态才允许合闸，避免重复或非法动作。
        if (this._animating || this._state !== 'off') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('on');
    }

    open() {
        // 只有在 on 状态才允许分闸，模拟正常开闸动作。
        if (this._animating || this._state !== 'on') return;
        this._animDur = this.config.animDur || 0.10;
        this._startAnim('off');
    }

    trip() {
        // trip 直接进入跳闸状态，动作更快并区别于普通分闸。
        if (this._state === 'trip') return;
        this._animDur = 0.06;
        this._startAnim('trip');
    }

    getState()     { return this._state; }
    isClosed()     { return this._state === 'on'; }
    isTripped()    { return this._state === 'trip'; }
    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

    update(state) {
        // 外部控制统一走 update()，根据输入值调用 close/open/trip。
        const s = String(state).toLowerCase();
        if (s === 'on'   || s === '1') this.close();
        if (s === 'off'  || s === '0') this.open();
        if (s === 'trip')              this.trip();
    }

    getConfigFields() {
        // 返回配置面板中的断路器参数字段，供编辑器动态展示。
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',        key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',        key: 'ratedCurrent', type: 'number' },
            { label: '脱扣倍数 (×In)',      key: 'tripCurrent',  type: 'number' },
            { label: '初始状态 on/off/trip',key: 'initState',    type: 'text'   },
            { label: '动作时间 (s)',         key: 'animDur',      type: 'number' },
            { label: '分励线圈电阻 (Ω)',     key: 'tripCoilR',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        // 对配置项做安全更新，并在必要时重建图形和状态.
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.tripCurrent  !== undefined) this.tripCurrent  = parseFloat(cfg.tripCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);
        if (cfg.tripCoilR    !== undefined) this._tripCoilR   = parseFloat(cfg.tripCoilR);

        if (cfg.initState !== undefined) {
            const want = cfg.initState.toLowerCase();
            if (['on', 'off', 'trip'].includes(want) && want !== this._state) {
                this.update(want);
            }
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        // 调用父类析构逻辑，保持生命周期一致性。
        super.destroy?.();
    }
}
