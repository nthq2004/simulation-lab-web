import { BaseComponent } from './BaseComponent.js';

/**
 * AddressWriter — 探测器地址写入器
 *
 * 用于更换探测器：把旧探测器接入写入器 → 按「读地址」读出其节点地址；
 * 断开旧探测器，接入新的（未设地址的）探测器 → 按「写地址」，
 * 即可把原地址写入新探测器，使新探测器可直接替换旧探测器接入系统。
 *
 * 接入判定：**必须正确接线**——写入器接口 rw_p/rw_n 与探测器 can1p/can1n 之间有实际连线，
 * 才视为"已接入"（仅靠近不识别）。
 */
export class AddressWriter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'address_writer';
        this.special = 'address_writer';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, scale: this.scale, range: this.range };

        // 接口（连接探测器的 CAN）
        this.addPort(this.W / 2 - 12, this.H, 'rw_p', 'wire', 'p');
        this.addPort(this.W / 2 + 12, this.H, 'rw_n', 'wire');
    }

    _recalcGeometry(_config) { this.W = 220; this.H = 165; }

    _initParameters(config) {
        this.label = config.label || '地址写入器';
        this.range = config.range || 140;
        this.readValue = null;   // 读到的地址
        this.readLoop = null;
        this.readZone = null;
        this.display = '--';
        this.hintText = '';
        this.hintT = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x: 0, y: 0, width: this.W, height: this.H, fill: '#37474f', stroke: '#1c262b', strokeWidth: 2, cornerRadius: 10 }));
        g.add(new Konva.Text({ x: 0, y: 8, width: this.W, text: this.label, fontSize: 14, fontStyle: 'bold', fill: '#eceff1', align: 'center' }));
        // LCD
        g.add(new Konva.Rect({ x: 30, y: 34, width: this.W - 60, height: 46, fill: '#1b1fd0', stroke: '#0a0a5a', strokeWidth: 2, cornerRadius: 4 }));
        // 读 / 写 按钮
        g.add(new Konva.Rect({ x: 34, y: 96, width: 68, height: 34, fill: '#2e7d32', stroke: '#1b5e20', strokeWidth: 2, cornerRadius: 6 }));
        g.add(new Konva.Text({ x: 34, y: 106, width: 68, text: '读地址', fontSize: 13, fontStyle: 'bold', fill: '#ffffff', align: 'center' }));
        g.add(new Konva.Rect({ x: 118, y: 96, width: 68, height: 34, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 2, cornerRadius: 6 }));
        g.add(new Konva.Text({ x: 118, y: 106, width: 68, text: '写地址', fontSize: 13, fontStyle: 'bold', fill: '#ffffff', align: 'center' }));
        // 接口插座
        g.add(new Konva.Rect({ x: this.W / 2 - 28, y: this.H - 14, width: 56, height: 14, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 3 }));
        this.addClickablePart('body', 0, 0, this.W, this.H);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._lcdText = new Konva.Text({
            x: 30, y: 42, width: this.W - 60, text: '--',
            fontSize: 26, fontFamily: 'Consolas, monospace', fontStyle: 'bold', fill: '#ffffff', align: 'center',
        });
        d.add(this._lcdText);
        this._hint = new Konva.Text({ x: 0, y: this.H - 30, width: this.W, text: '请接入探测器', fontSize: 10, fill: '#b0bec5', align: 'center' });
        d.add(this._hint);
    }

    _bindInteraction() {
        // 整机（供演示箭头指示）——先添加，避免遮挡读/写按钮的命中
        this.addClickablePart('panel', 0, 0, this.W, this.H);
        const read = this.addClickablePart('read', 34, 96, 68, 34, true);
        if (read) read.on('click tap', (e) => { e.cancelBubble = true; this.readAddr(); });
        const write = this.addClickablePart('write', 118, 96, 68, 34, true);
        if (write) write.on('click tap', (e) => { e.cancelBubble = true; this.writeAddr(); });
    }

    /** 接口世界坐标（就近识别用） */
    _plugWorld() {
        const p = { x: this.W / 2, y: this.H };
        try { return this.group.getAbsoluteTransform().point(p); }
        catch (e) { const g = this.group.getAbsolutePosition(); return { x: g.x + p.x, y: g.y + p.y }; }
    }

    /** 找到接入的探测器：仅当写入器接口 rw_p/rw_n 与探测器 can1p/can1n 有实际连线 */
    _findPlugged() {
        const comps = this.sys && this.sys.comps; if (!comps) return null;
        const myP = `${this.id}_wire_rw_p`, myN = `${this.id}_wire_rw_n`;
        const hasConn = (a, b) => (this.sys.conns || []).some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
        for (const c of Object.values(comps)) {
            if (!c || !c.isDetector) continue;
            if (hasConn(myP, `${c.id}_wire_can1p`) || hasConn(myN, `${c.id}_wire_can1n`)
                || hasConn(myP, `${c.id}_wire_can1n`) || hasConn(myN, `${c.id}_wire_can1p`)) return c;
        }
        return null;
    }

    /** 读地址：读取接入探测器当前的节点地址 */
    readAddr() {
        const det = this._findPlugged();
        if (!det) { this.display = 'NO DEV'; this._hint3('未检测到探测器，请接入后再读'); return; }
        if (!det.isConfigured || !det.isConfigured()) { this.display = 'NO ADDR'; this._hint3('该探测器尚未设置地址，应先读旧探测器'); return; }
        this.readValue = det.nodeAddress;
        this.readLoop = det.loop;
        this.readZone = det.zone;
        this.display = `#${det.nodeAddress}`;
        this._hint3(`已读取地址 #${det.nodeAddress}（LOOP${det.loop} ZONE${det.zone}）`);
    }

    /** 写地址：把读到的地址写入接入的新探测器 */
    writeAddr() {
        const det = this._findPlugged();
        if (!det) { this.display = 'NO DEV'; this._hint3('未检测到探测器，请接入后再写'); return; }
        if (this.readValue == null) { this.display = 'NO DATA'; this._hint3('请先读取旧探测器的地址'); return; }
        det.setNodeAddress(this.readValue, this.readLoop, this.readZone);
        this.display = `W#${this.readValue}`;
        this._hint3(`已将地址 #${this.readValue} 写入该探测器，可直接替换接入系统`);
    }

    _hint3(t) { this.hintText = t; this.hintT = Date.now(); }

    tick() {
        if (this._lcdText) this._lcdText.text(this.display);
        const det = this._findPlugged();
        let hint;
        if (this.hintText && Date.now() - this.hintT < 3500) hint = this.hintText;
        else if (!det) hint = '未接入：请将探测器 can1p/can1n 接入写入器 rw_p/rw_n';
        else if (!det.isConfigured || !det.isConfigured()) hint = `已接入：${det.label || '探测器'}（未设地址）`;
        else hint = `已接入：${det.label || '探测器'} #${det.nodeAddress}`;
        if (this._hint) this._hint.text(hint);
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
            { label: '就近识别距离 (px)', key: 'range', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.range !== undefined) this.range = parseFloat(cfg.range) || 140;
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}

export default AddressWriter;
