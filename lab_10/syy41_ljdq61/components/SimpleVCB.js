import { BaseComponent } from './BaseComponent.js';

/**
 * SimpleVCB 简化版真空断路器（带上下隔离开关）
 *
 * 结构（自上而下）：
 *   上隔离 → 真空泡（三相主触头）→ 下隔离
 *   上隔离：L1/L2/L3 进线
 *   下隔离：T1/T2/T3 出线
 *
 * 交互（mousedown 触发 + cancelBubble 阻止组件拖拽，避免 click 被拖拽吞掉）：
 *   - 点击真空泡 → 主触头合闸/分闸
 *   - 点击隔离片区域 → 上下隔离开关同时闭合/断开
 *
 * 联锁：
 *   ① 主触头闭合（合闸）→ 隔离开关无法断开
 *   ② 隔离开关断开 → 主触头无法闭合（合闸）
 *
 * 隔离片：竖直铜片桥接断口（参照真空断路器隔离连接片）。
 *   闭合时向左移动、对准断口接通；断开时向右移动、断口分离。
 *
 * 电气模型：复用 ACB / MainsSwitch stamp（合闸注入 0.0001Ω，分闸隔离）。
 *   隔离断开时置 _workPos=1，stampACBs 导通条件 _workPos===0 不满足 → 全隔离。
 *
 * 端口：顶部 L1/L2/L3、底部 T1/T2/T3（6 口）
 */
const COLORS = ['#e03030', '#20a030', '#2050e0'];

export class SimpleVCB extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(100, config.width  || 100);
        this.height = Math.max(165, config.height || 175);

        this.type    = 'ACB';
        this.special = 'MainsSwitch';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:     this.label,
            initState: this._state,
            initIso:   this._isoClosed ? 'on' : 'off',
        };

        // 主回路端口：顶部 L1/L2/L3（上隔离进线），底部 T1/T2/T3（下隔离出线）
        ['l1', 'l2', 'l3'].forEach((nm, i) => {
            this.addPort(this._staticXs[i], 2, nm, 'wire');
            this.addPort(this._staticXs[i], this.height - 2, ['t1', 't2', 't3'][i], 'wire', 'p');
        });
    }

    // ═══════════════════════════════════════
    // 几何（紧凑：泡贴合三相列，上下隔离对称）
    // ═══════════════════════════════════════

    _recalcGeometry() {
        const w = this.width, h = this.height;
        const gap = 26;
        this._staticXs = [w / 2 - gap, w / 2, w / 2 + gap];
        // 真空泡：矩形（直线边）、贴合三相列（左右各留 13px）
        this._bottle = {
            x: this._staticXs[0] - 13,
            y: 64,
            w: this._staticXs[2] + 13 - (this._staticXs[0] - 13),
            h: 50,
        };
        // 上/下隔离断口中心 y（上下对称：到泡顶/泡底距离相等）
        this._isoTopY = this._bottle.y - 24;       // 40
        this._isoBotY = this._bottle.y + this._bottle.h + 24;  // 138
        // 泡内主触头：上静触头 / 下动触头（间距缩小）
        this._contactTopY = this._bottle.y + 14;
        this._contactBotY = this._bottle.y + this._bottle.h - 12;
        this._discRX = 10;
        this._discRY = 3.4;
        this._bladeCloseY = this._contactTopY + 5;
        this._bladeOpenY  = this._contactBotY - 5;
        this._bladeW      = 4;
        // 竖直隔离片（桥接断口）
        this._isoGapHalf = 9;     // 断口半间隙（上下端子间距的一半）
        this._isoOpenX   = 18;    // 断开时隔离片右移量
        this._isoLinkW   = 7;     // 铜片宽
        this._isoLinkH   = 20;    // 铜片高（桥接断口全高 18）
    }

    // ═══════════════════════════════════════
    // 参数
    // ═══════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || '真空断路器(带隔离)';
        this.function = '真空断路器(带隔离)';
        this._state = String(config.initState || '').toLowerCase() === 'on' ? 'on' : 'off';
        this._isoClosed = String(config.initIso || 'on').toLowerCase() !== 'off';
        this._workPos = this._isoClosed ? 0 : 1;   // 求解器导通条件：_workPos===0
        this._contactT = this._state === 'on' ? 1 : 0;
        this._animating = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._createClickableParts();   // 点击交互直接绑定在可识别部件上
    }

    _createClickableParts() {
        // 真空泡（点击合闸/分闸）
        const hitMain = this.addClickablePart('main-contact', this._bottle.x - 6, this._bottle.y - 6, this._bottle.w + 12, this._bottle.h + 12);
        if (hitMain) hitMain.on('click tap', (e) => { e.cancelBubble = true; this.toggleMain(); });
        // 上/下隔离片（点击同时切换上下隔离）
        const hitTop = this.addClickablePart('iso-switch-top', this._staticXs[0] - 20, this._isoTopY - 16, this._staticXs[2] + 20, 34);
        if (hitTop) hitTop.on('click tap', (e) => { e.cancelBubble = true; this.toggleIso(); });
        const hitBot = this.addClickablePart('iso-switch-bot', this._staticXs[0] - 20, this._isoBotY - 16, this._staticXs[2] + 20, 34);
        if (hitBot) hitBot.on('click tap', (e) => { e.cancelBubble = true; this.toggleIso(); });
    }

    // ═══════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════

    _drawStaticParts() {
        const s = this._staticGroup;
        s.add(new Konva.Rect({ x: 0, y: 0, width: this.width, height: this.height, fill: '#eef2f5', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: this.width - 6, height: this.height - 6, fill: '#e4eaef', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1 }));
       
        this._staticXs.forEach((x, i) => {
            const c = COLORS[i];
            const g = this._isoGapHalf;
            // 上隔离引线：L 接线柱（顶部）→ 断口上端子；断口下端子 → 泡顶
            s.add(new Konva.Line({ points: [x, 4, x, this._isoTopY - g], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [x, this._isoTopY + g, x, this._bottle.y], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 泡内引线：泡顶 → 上静触头（泡内可见）
            s.add(new Konva.Line({ points: [x, this._bottle.y, x, this._contactTopY], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 泡内引线：动触头基准 → 泡底（泡内可见）
            s.add(new Konva.Line({ points: [x, this._contactBotY, x, this._bottle.y + this._bottle.h], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 下隔离引线：泡底 → 断口上端子；断口下端子 → T 接线柱（底部）
            s.add(new Konva.Line({ points: [x, this._bottle.y + this._bottle.h, x, this._isoBotY - g], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [x, this._isoBotY + g, x, this.height - 4], stroke: c, strokeWidth: 2.5, lineCap: 'round' }));
            // 断口金点（上/下隔离各两个端子）
            [this._isoTopY - g, this._isoTopY + g, this._isoBotY - g, this._isoBotY + g].forEach(ty => {
                s.add(new Konva.Circle({ x, y: ty, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
            });
            // 上静触头
            s.add(new Konva.Ellipse({ x, y: this._contactTopY, radiusX: this._discRX, radiusY: this._discRY, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 0.8 }));
            // 端子标签
            s.add(new Konva.Text({ x: x - 20, y: 4, text: ['L1', 'L2', 'L3'][i], fontSize: 11, fontStyle: 'bold', fill: c }));
            s.add(new Konva.Text({ x: x - 20, y: this.height - 16, text: ['T1', 'T2', 'T3'][i], fontSize: 11, fontStyle: 'bold', fill: c }));
        });

        // 真空泡：矩形（直线边，无圆弧）
        const b = this._bottle;
        s.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, fill: 'rgba(220,232,248,0.55)', stroke: '#5a8090', strokeWidth: 2 }));
     
    }

    // ═══════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 三相动触头（导电杆 + 圆面），组 y 控制合/分位置
        this._blades = [];
        const bg = new Konva.Group({ y: 0, listening: false });
        this._staticXs.forEach((x, i) => {
            const blade = new Konva.Group({ x, y: this._bladeOpenY });
            blade.add(new Konva.Line({ points: [0, 0, 0, this._contactBotY - this._bladeOpenY], stroke: COLORS[i], strokeWidth: this._bladeW, lineCap: 'round' }));
            blade.add(new Konva.Ellipse({ x: 0, y: 0, radiusX: this._discRX, radiusY: this._discRY, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 0.8 }));
            bg.add(blade);
            this._blades.push(blade);
        });
        this._bladesGroup = bg;
        d.add(bg);

        // 上下隔离片：竖直铜片桥接断口（同组容器，整体左/右平移）
        const g = new Konva.Group({ x: 0, y: 0, listening: false });
        const x0 = this._staticXs[0], x2 = this._staticXs[2];
        [this._isoTopY, this._isoBotY].forEach(isoY => {
            g.add(new Konva.Line({ points: [x0 + 8, isoY, x2 - 8, isoY], stroke: '#7a8494', strokeWidth: 1.2, dash: [4, 3], listening: false }));
        });
        [this._isoTopY, this._isoBotY].forEach(isoY => {
            this._staticXs.forEach(x => {
                const link = new Konva.Group({ x, y: isoY });
                link.add(new Konva.Rect({
                    x: -this._isoLinkW / 2, y: -this._isoLinkH / 2,
                    width: this._isoLinkW, height: this._isoLinkH, cornerRadius: 1.5,
                    fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1,
                }));
                g.add(link);
            });
        });
        this._isoGroup = g;
        d.add(g);

        // 状态指示（顶部小字）
        this._stateText = new Konva.Text({
            x: 4, y: 18, width: this.width - 8, align: 'center',
            fontSize: 9, fontStyle: 'bold', listening: false,
        });
        this._refreshVisual();
    }

    // ═══════════════════════════════════════
    // 状态控制（含联锁）
    // ═══════════════════════════════════════

    toggleMain() {
        if (this._state === 'on') {
            this._state = 'off';
        } else {
            if (!this._isoClosed) {
                this._flashHint('联锁：隔离开关断开，禁止合闸');
                return;
            }
            this._state = 'on';
        }
        this._syncWorkPos();
        this._refreshVisual();
    }

    toggleIso() {
        if (!this._isoClosed) {
            this._isoClosed = true;
        } else {
            if (this._state === 'on') {
                this._flashHint('联锁：主触头闭合，禁止断开隔离');
                return;
            }
            this._isoClosed = false;
        }
        this._syncWorkPos();
        this._refreshVisual();
    }

    tryClose() {
        if (this._state === 'on') return false;
        if (!this._isoClosed) return false;
        this._state = 'on';
        this._syncWorkPos();
        this._refreshVisual();
        return true;
    }

    tryTrip() {
        if (this._state !== 'on') return false;
        this._state = 'off';
        // 跳闸后自动复位隔离（闭合），便于再次手动合闸
        this._isoClosed = true;
        this._syncWorkPos();
        this._refreshVisual();
        return true;
    }

    _syncWorkPos() {
        this._workPos = this._isoClosed ? 0 : 1;
    }

    _flashHint(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(msg);
        } else if (this.sys && this.sys.uiManager && typeof this.sys.uiManager.showFloatingTip === 'function') {
            this.sys.uiManager.showFloatingTip(msg);
        }
    }

    _refreshVisual() {
        // 动触头位置：合闸上移 / 分闸下移
        const target = this._state === 'on' ? this._bladeCloseY : this._bladeOpenY;
        this._blades.forEach(b => b.y(target));
        // 隔离片：闭合向左对准断口（x=0），断开向右移开（x=+isoOpenX）
        this._isoGroup.x(this._isoClosed ? 0 : this._isoOpenX);
        if (this._stateText) {
            const iso = this._isoClosed ? '隔离合' : '隔离分';
            const main = this._state === 'on' ? '主触合' : '主触分';
            const blocked = (this._state === 'on' && this._isoClosed) ? ' 联锁:主触合·隔离锁定' : (this._state === 'off' && !this._isoClosed ? ' 联锁:隔离分·主触锁定' : '');
            this._stateText.text(`${main}·${iso}${blocked}`);
            this._stateText.fill(this._state === 'on' ? '#1b8a1b' : '#c0392b');
        }
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════
    // 仿真主循环（in-place 平滑刷新）
    // ═══════════════════════════════════════

    tick(dt) {
        const targetT = this._state === 'on' ? 1 : 0;
        this._contactT += (targetT - this._contactT) * Math.min(1, dt * 12);
        const y = this._bladeOpenY + (this._bladeCloseY - this._bladeOpenY) * this._contactT;
        this._blades.forEach(b => b.y(y));
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════
    // 公开 API（供求解器/工作流）
    // ═══════════════════════════════════════

    isClosed()    { return this._state === 'on'; }
    isGrounded()  { return false; }
    getState()    { return this._state; }
    isIsoClosed() { return this._isoClosed; }

    getConfigFields() {
        return [
            { label: '初始主触头状态', key: 'initState', type: 'select', options: [
                { label: '分闸', value: 'off' },
                { label: '合闸', value: 'on' },
            ]},
            { label: '初始隔离状态', key: 'initIso', type: 'select', options: [
                { label: '闭合', value: 'on' },
                { label: '断开', value: 'off' },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.initState !== undefined) {
            this._state = String(cfg.initState).toLowerCase() === 'on' ? 'on' : 'off';
        }
        if (cfg.initIso !== undefined) {
            this._isoClosed = String(cfg.initIso).toLowerCase() !== 'off';
        }
        this._syncWorkPos();
        this._refreshVisual();
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}