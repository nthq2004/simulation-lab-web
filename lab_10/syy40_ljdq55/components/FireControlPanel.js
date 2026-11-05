import { BaseComponent } from './BaseComponent.js';

// ZONE → 场所
const ZONE_DEVICE = { 1: '发电机', 2: '主机', 3: '锅炉', 4: '分油机' };
// 设备显示顺序（行2：主机、发电机；行3：分油机、锅炉）
const DISPLAY = [2, 1, 4, 3];
// 右侧输出口 → 控制的分区：第1路锅炉、第2路分油机、第3路发电机、第4路主机
const OUT_ZONE = { 1: 3, 2: 4, 3: 1, 4: 2 };

/**
 * FireControlPanel — 消防控制面板（标准工业控制盘样式）
 *
 * 四行布局：
 *   行1：主电源、应急电源、泵运行（指示灯；主/应急电源对应火灾报警系统的主电/备电）
 *   行2：主机、发电机 —— 左=绿色开阀/关阀按钮，右=火灾报警灯（与本区探测器联动）
 *   行3：分油机、锅炉 —— 同上
 *   行4：手动/自动旋钮开关、泵起动、泵停机、试灯
 *
 * 真电气：signalContacts 闭合对应电磁阀线圈回路与消防泵控制回路。
 */
export class FireControlPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = 560;
        this.H = 450;
        this.type = 'compressor_panel';   // 复用面板信号触点的电气 stamp
        this.special = 'fire_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, auto: this.auto, pumpId: this.pumpId, facpId: this.facpId };

        // 端口：底部（共用 24V、面板地、泵输出）；右侧（电磁阀 4 路输出）
        this.addPort(180, this.H, 'p24', 'wire', 'p');
        this.addPort(280, this.H, 'gnd', 'wire');
        this.addPort(380, this.H, 'pump_o', 'wire');
        this.addPort(this.W, 110, 'v1_o', 'wire');
        this.addPort(this.W, 170, 'v2_o', 'wire');
        this.addPort(this.W, 230, 'v3_o', 'wire');
        this.addPort(this.W, 290, 'v4_o', 'wire');

        // 阀与泵均使用共用 24V（p24）作为公共端
        this.signalContacts = [
            ['p24', 'v1_o', 'v1'],
            ['p24', 'v2_o', 'v2'],
            ['p24', 'v3_o', 'v3'],
            ['p24', 'v4_o', 'v4'],
            ['p24', 'pump_o', 'pump'],
        ];
    }

    _recalcGeometry(_config) { this.W = 560; this.H = 450; }

    _initParameters(config) {
        this.label = config.label || '消防控制面板';
        this.auto = !!config.auto;
        this.pumpId = config.pumpId || 'fpump';
        this.facpId = config.facpId || 'facp';
        this.pumpCmd = false;
        this.valveManual = { 1: false, 2: false, 3: false, 4: false };
        this._testT = 0;
        this._zoneFire = { 1: false, 2: false, 3: false, 4: false };
        this._mainOK = false;
        this._bkOK = false;
        this._powered = false;
        this._devPos = {};
    }

    _init() { this._drawStaticParts(); this._createDynamicNodes(); this._bindInteraction(); }

    // 设备块位置：DISPLAY 顺序，每行两个
    _devXY(z) {
        const i = DISPLAY.indexOf(z);
        const cx = (i % 2 === 0) ? 150 : 410;
        const y = (i < 2) ? 176 : 288;
        return { cx, y };
    }

    // ═══════════════════════════════════════════════════════
    // 静态绘制（面板 / 铭牌 / 灯座 / 按钮座 / 标签）
    // ═══════════════════════════════════════════════════════
    _drawStaticParts() {
        const g = this._staticGroup;
        // 面板（浅灰工业色）
        g.add(new Konva.Rect({ x: 0, y: 0, width: this.W, height: this.H, fill: '#c9ced2', stroke: '#767d83', strokeWidth: 3, cornerRadius: 8 }));
        g.add(new Konva.Rect({ x: 5, y: 5, width: this.W - 10, height: this.H - 10, fill: 'rgba(255,255,255,0.22)', stroke: '#aeb4b8', strokeWidth: 1, cornerRadius: 6, listening: false }));
        // 铭牌
        g.add(new Konva.Rect({ x: this.W / 2 - 150, y: 10, width: 300, height: 28, fill: '#33383d', cornerRadius: 4 }));
        g.add(new Konva.Text({ x: this.W / 2 - 150, y: 16, width: 300, text: this.label, fontSize: 15, fontStyle: 'bold', fill: '#f2f4f6', align: 'center' }));

        // 行1 指示灯（灯座 + 标签）
        [[110, '主电源'], [280, '应急电源'], [450, '泵运行']].forEach(([x, t]) => {
            g.add(new Konva.Circle({ x, y: 68, radius: 24, fill: '#9aa2a8', stroke: '#6b7278', strokeWidth: 2 }));
            g.add(new Konva.Text({ x: x - 60, y: 94, width: 120, text: t, fontSize: 13, fontStyle: 'bold', fill: '#1c1f22', align: 'center' }));
        });

        // 行2/行3 设备块
        DISPLAY.forEach(z => {
            const { cx, y } = this._devXY(z);
            // 名称铭牌
            g.add(new Konva.Rect({ x: cx - 78, y: y - 60, width: 156, height: 26, fill: '#33383d', cornerRadius: 4 }));
            g.add(new Konva.Text({ x: cx - 78, y: y - 55, width: 156, text: ZONE_DEVICE[z], fontSize: 14, fontStyle: 'bold', fill: '#f2f4f6', align: 'center' }));
            // 开阀/关阀 按钮座（左）
            g.add(new Konva.Circle({ x: cx - 58, y, radius: 24, fill: '#9aa2a8', stroke: '#6b7278', strokeWidth: 2 }));
            g.add(new Konva.Text({ x: cx - 110, y: y + 28, width: 104, text: '开阀/关阀', fontSize: 11, fontStyle: 'bold', fill: '#1c1f22', align: 'center' }));
            // 火灾报警 灯座（右）
            g.add(new Konva.Circle({ x: cx + 58, y, radius: 24, fill: '#9aa2a8', stroke: '#6b7278', strokeWidth: 2 }));
            g.add(new Konva.Text({ x: cx - 6, y: y + 28, width: 104, text: '火灾报警', fontSize: 11, fontStyle: 'bold', fill: '#1c1f22', align: 'center' }));
        });

        // 行4 控件标签（与控制器中心一一对齐：88 / 216 / 344 / 472）
        [[88, '手动 / 自动'], [216, '泵起动'], [344, '泵停机'], [472, '试灯']].forEach(([x, t]) => {
            g.add(new Konva.Text({ x: x - 60, y: 390, width: 120, text: t, fontSize: 13, fontStyle: 'bold', fill: '#1c1f22', align: 'center' }));
        });
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（灯面 / 按钮面 / 旋钮）
    // ═══════════════════════════════════════════════════════
    _mkLamp(x, y, r, off) {
        const n = new Konva.Circle({ x, y, radius: r, fill: off, stroke: '#4a4f55', strokeWidth: 1, listening: false });
        this._dynamicGroup.add(n);
        return n;
    }

    _createDynamicNodes() {
        // 行1 灯面
        this._lampMain = this._mkLamp(110, 68, 19, '#243024');
        this._lampBk = this._mkLamp(280, 68, 19, '#243024');
        this._lampPump = this._mkLamp(450, 68, 19, '#243024');

        // 设备 阀按钮面（绿）/ 火灾报警灯面（红）
        this._valveLamp = {};
        this._fireLamp = {};
        DISPLAY.forEach(z => {
            const { cx, y } = this._devXY(z);
            this._valveLamp[z] = this._mkLamp(cx - 58, y, 19, '#0a2e0a');
            this._fireLamp[z] = this._mkLamp(cx + 58, y, 19, '#3a0a0a');
        });

        // 行4 手动/自动旋钮（中心旋转）
        this._modeGroup = new Konva.Group({ x: 88, y: 360 });
        this._modeGroup.add(new Konva.Circle({ x: 0, y: 0, radius: 24, fill: '#2b2f33', stroke: '#4a4f55', strokeWidth: 2 }));
        this._modeGroup.add(new Konva.Line({ points: [0, 0, 0, -22], stroke: '#e8ebee', strokeWidth: 4, lineCap: 'round' }));
        this._dynamicGroup.add(this._modeGroup);

        // 行4 泵起动 / 泵停机 / 试灯
        this._btnStart = new Konva.Circle({ x: 216, y: 360, radius: 24, fill: '#1faa1f', stroke: '#123b12', strokeWidth: 2 });
        this._btnStop = new Konva.Circle({ x: 344, y: 360, radius: 24, fill: '#c62828', stroke: '#5a0a0a', strokeWidth: 2 });
        this._btnTest = new Konva.Circle({ x: 472, y: 360, radius: 24, fill: '#20262a', stroke: '#101418', strokeWidth: 2 });
        this._dynamicGroup.add(this._btnStart, this._btnStop, this._btnTest);

        // 提示行
        this._hint = new Konva.Text({ x: 0, y: 418, width: this.W, text: '', fontSize: 11, fontStyle: 'bold', fill: '#3a3f44', align: 'center' });
        this._dynamicGroup.add(this._hint);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════
    _bindInteraction() {
        const part = (id, cx, cy, w, h, fn) => {
            const hit = this.addClickablePart(id, cx - w / 2, cy - h / 2, w, h, true);
            if (fn) hit.on('click tap', (e) => { e.cancelBubble = true; fn(); });
        };
        // 各设备：绿色开阀/关阀按钮（手动切换）
        DISPLAY.forEach(z => {
            const { cx, y } = this._devXY(z);
            part(`valve-${z}`, cx - 58, y, 46, 46, () => { this.valveManual[z] = !this._valveOpen(z); });
        });
        // 行4
        part('sel-auto', 88, 360, 58, 58, () => { this.auto = !this.auto; });
        part('btn-pump-start', 216, 360, 52, 52, () => { this.pumpCmd = true; });
        part('btn-pump-stop', 344, 360, 52, 52, () => { this.pumpCmd = false; });
        part('btn-lamp-test', 472, 360, 52, 52, () => { this._testT = 1800; });
    }

    // ═══════════════════════════════════════════════════════
    // 逻辑
    // ═══════════════════════════════════════════════════════
    _zoneFireOf(z) { return !!this._zoneFire[z]; }
    _valveOpen(z) { return this.valveManual[z] || (this.auto && this._zoneFire[z]); }
    _pumpOn() { return this.pumpCmd || (this.auto && DISPLAY.some(z => this._zoneFire[z])); }

    getSignalResistance(key) {
        const OPEN = 1e9, CLOSE = 0.01;
        // 24V 无电：无法输出控制信号（触点保持断开）
        if (!this._powered) return OPEN;
        if (key === 'pump') {
            // 主电源与应急电源均无电时，泵无法起动
            const acOK = this._mainOK || this._bkOK;
            return (acOK && this._pumpOn()) ? CLOSE : OPEN;
        }
        // 右侧四路输出按 OUT_ZONE 映射到分区电磁阀
        if (/^v[1-4]$/.test(key)) return this._valveOpen(OUT_ZONE[parseInt(key[1])]) ? CLOSE : OPEN;
        return OPEN;
    }

    tick(dt) {
        const d = dt || 0.05;
        const p = `${this.id}_wire_`;
        this._powered = this.sys.getVoltageBetween(`${p}p24`, `${p}gnd`) > 18;

        const facp = this.sys.comps && this.sys.comps[this.facpId];
        for (let z = 1; z <= 4; z++) this._zoneFire[z] = !!(facp && facp.zoneAlarm && facp.zoneAlarm[z]);
        this._mainOK = !!(facp && facp._mainOK);
        this._bkOK = !!(facp && facp._bkOK);

        if (this._testT > 0) this._testT -= d * 1000;
        const test = this._testT > 0;

        // 消防泵由泵控制触点驱动（泵自身按控制端电压 ≥12V 起动）
        const pump = this.sys.comps && this.sys.comps[this.pumpId];
        const pumpRunning = !!(pump && pump.pumpOn);

        // 24V 无电时灯不亮；试灯亦受 24V 限制
        const on = (v) => this._powered && (test || v);
        const lit = (n, v, c, off) => { if (n) n.fill(on(v) ? c : off); };
        // 行1：主电源/应急电源（对应主电/备电）、泵运行
        lit(this._lampMain, this._mainOK, '#25e025', '#243024');
        lit(this._lampBk, this._bkOK, '#25e025', '#243024');
        lit(this._lampPump, pumpRunning, '#25e025', '#243024');
        // 行2/3：阀开（绿）与火灾报警（红）
        DISPLAY.forEach(z => {
            lit(this._valveLamp[z], this._valveOpen(z), '#25e025', '#0a2e0a');
            lit(this._fireLamp[z], this._zoneFireOf(z), '#ff2a2a', '#3a0a0a');
        });
        // 行4
        this._modeGroup.rotation(test ? 0 : (this.auto ? 45 : -45));
        if (this._powered && test) { this._btnStart.fill('#25e025'); this._btnStop.fill('#ff2a2a'); this._btnTest.fill('#f2f4f6'); }
        else if (this._powered) { this._btnStart.fill('#1faa1f'); this._btnStop.fill('#c62828'); this._btnTest.fill('#20262a'); }
        else { this._btnStart.fill('#243024'); this._btnStop.fill('#3a1414'); this._btnTest.fill('#15181b'); }

        const names = DISPLAY.filter(z => this._zoneFire[z]).map(z => ZONE_DEVICE[z]);
        this._hint.text(this.auto
            ? (names.length ? `自动模式 · 火警区域：${names.join('、')} → 自动起动消防泵并开启对应电磁阀` : '自动模式 · 待命')
            : '手动模式 · 按绿色按钮开阀/关阀，按「泵起动」起动消防泵');

        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
            { label: '初始模式', key: 'auto', type: 'select', options: [{ label: '手动', value: false }, { label: '自动', value: true }] },
            { label: '消防泵 ID', key: 'pumpId', type: 'text' },
            { label: '火灾报警控制器 ID', key: 'facpId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.auto !== undefined) this.auto = (cfg.auto === true || cfg.auto === 'true');
        if (cfg.pumpId !== undefined) this.pumpId = cfg.pumpId;
        if (cfg.facpId !== undefined) this.facpId = cfg.facpId;
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}

export default FireControlPanel;
