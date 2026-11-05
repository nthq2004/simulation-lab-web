import { BaseComponent } from './BaseComponent.js';
import { CANId } from '../can/CANBUS.js';

const TYPE_EN = { 1: 'Smoke', 2: 'Flame', 3: 'Heat', 4: 'Hand' };
const NMT_CMD = { 0x01: 'START 启动', 0x02: 'STOP 停止', 0x81: 'RESET 复位', 0x82: 'RESETCOM 通信复位' };
const CFG_CMD = { 0x30: '隔离设备', 0x31: '解除隔离', 0x32: '复位火警' };

/**
 * CanAnalyzer — CAN 总线分析仪（新组件）
 *
 * 接在探测回路末端，旁路监听总线上**所有** CAN 报文（`bus.addSniffer`）。
 * 双击组件打开抓包界面：逐帧显示 ID / 类型 / 节点地址 / DLC / 数据 / 详细解释。
 */
export class CanAnalyzer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = 170;
        this.H = 130;
        this.type = 'can_analyzer';
        this.special = 'can_analyzer';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, scale: this.scale };

        // 回路接口（左侧）
        this.addPort(0, 48, 'can1p', 'wire', 'p');
        this.addPort(0, 64, 'can1n', 'wire');
    }

    _recalcGeometry(_config) { this.W = 170; this.H = 130; }

    _initParameters(config) {
        this.label = config.label || 'CAN 总线分析仪';
        this.busConnected = false;
        this.captured = [];          // 已抓取帧（最新在前）
        this._seq = 0;               // 帧序号（单调递增）
        this._capturing = true;
        this._sniffRegistered = false;
        this._dirty = false;
        this._panel = null;
        this._timer = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x: 0, y: 0, width: this.W, height: this.H, fill: '#263238', stroke: '#101418', strokeWidth: 2, cornerRadius: 8 }));
        g.add(new Konva.Rect({ x: 2, y: 2, width: this.W - 4, height: 24, fill: '#37474f', cornerRadius: [6, 6, 0, 0], listening: false }));
        g.add(new Konva.Text({ x: 0, y: 6, width: this.W, text: this.label, fontSize: 12, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));
        // 抓包屏
        g.add(new Konva.Rect({ x: 16, y: 34, width: this.W - 32, height: 52, fill: '#05121b', stroke: '#0b2a3a', strokeWidth: 1.5, cornerRadius: 4 }));
        // 双绞线接口
        g.add(new Konva.Line({ points: [0, 48, 10, 48], stroke: '#e74c3c', strokeWidth: 3, listening: false }));
        g.add(new Konva.Line({ points: [0, 64, 10, 64], stroke: '#cfd8dc', strokeWidth: 3, listening: false }));
        g.add(new Konva.Text({ x: 8, y: 100, width: this.W - 16, text: '双击打开抓包界面', fontSize: 9, fill: '#90a4ae', align: 'center' }));
        this.addClickablePart('body', 0, 0, this.W, this.H);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._led = new Konva.Circle({ x: this.W - 16, y: 92, radius: 5, fill: '#37474f', stroke: '#101418', strokeWidth: 1 });
        d.add(this._led);
        this._screenText = new Konva.Text({ x: 22, y: 40, width: this.W - 44, text: '', fontSize: 11, fontFamily: 'Consolas, monospace', fill: '#7fe3ff', lineHeight: 1.35, listening: false });
        d.add(this._screenText);
    }

    _bindInteraction() {
        // 双击打开抓包界面
        this.group.on('dblclick dbltap', (e) => { e.cancelBubble = true; this.openPanel(); });
    }

    // ═══════ 抓包 ═══════
    tick(dt) {
        // 惰性注册嗅探器（总线在 ControlSystem.init 中创建，晚于组件构造）
        if (!this._sniffRegistered && this.sys && this.sys.canBus && typeof this.sys.canBus.addSniffer === 'function') {
            try { this.sys.canBus.addSniffer(this.id, (f) => this._onSniff(f)); this._sniffRegistered = true; } catch (e) { /* ignore */ }
        }
        const p = `${this.id}_wire_`;
        try { this.busConnected = this.sys.isOnCanBus(`${p}can1p`) && this.sys.isOnCanBus(`${p}can1n`); } catch (e) { this.busConnected = false; }

        if (this._screenText) {
            const n = this.captured.length;
            const last = this.captured[0];
            const lastDesc = last ? (this._decode(last).desc || '').slice(0, 22) : '等待报文…';
            this._screenText.text(`CAP ${n}\n${lastDesc}`);
        }
        if (this._led) this._led.fill(this.busConnected ? '#25d425' : '#37474f');

        this.markDirty();
        this._refreshIfDirty();
    }

    _onSniff(frame) {
        if (!this._capturing || !this.busConnected) return;
        this._seq += 1;
        this.captured.unshift({
            seq: this._seq,
            id: frame.id,
            data: [...(frame.data || [])],
            sender: frame.sender,
            timestamp: frame.timestamp || Date.now(),
            dlc: frame.dlc,
        });
        if (this.captured.length > 600) this.captured.pop();
        this._dirty = true;
    }

    _fmtTime(ts) {
        const d = new Date(ts || Date.now());
        const z = (x) => String(x).padStart(2, '0');
        return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    }

    /** 逐帧详细解释 */
    _decode(f) {
        const { funcCode, nodeAddr } = CANId.decode(f.id);
        const d = f.data || [];
        const hex = (b) => '0x' + (b >>> 0).toString(16).padStart(2, '0').toUpperCase();
        let type = '', desc = '';
        if (funcCode === 0x00) {                 // NMT
            type = 'NMT';
            desc = `网络管理：${NMT_CMD[d[0]] || ('命令 ' + hex(d[0] || 0))}，目标 ${d[1] === 0 ? '全部节点' : ('#' + d[1])}`;
        } else if (funcCode === 0x0F) {          // BROADCAST
            type = 'BCAST';
            desc = d[0] === 0x05 ? '运行广播（心跳 Operational）' : `广播 ${hex(d[0] || 0)}`;
        } else if (funcCode === 0x02) {          // 配置/命令（主站 → 从站）
            type = 'CFG';
            desc = `主站 → 节点#${nodeAddr}：${CFG_CMD[d[0]] || ('配置命令 ' + hex(d[0] || 0))}`;
        } else if (funcCode === 0x01) {          // 上报
            const comp = this.sys && this.sys.comps && this.sys.comps[f.sender];
            if (comp && comp.isDetector) {
                type = 'DET-RPT';
                const st = d[0] || 0;
                const bits = [];
                if (st & 0x01) bits.push('火警');
                if (st & 0x02) bits.push('隔离');
                if (st & 0x04) bits.push('故障');
                type += '';
                desc = `探测器上报：${bits.length ? bits.join('+') : '正常'}，LOOP${d[1]} ZONE${d[2]} ${TYPE_EN[d[3]] || ('类型' + d[3])}`;
            } else {
                type = 'RPT';
                desc = `节点#${nodeAddr} 上报 [${d.map(hex).join(' ')}]`;
            }
        } else {
            type = 'F' + funcCode.toString(16).toUpperCase();
            desc = `功能码 ${hex(funcCode)}，节点#${nodeAddr}，数据 [${d.map(hex).join(' ')}]`;
        }
        return { type, addr: nodeAddr, desc };
    }

    // ═══════ 抓包界面（DOM） ═══════
    openPanel() {
        if (this._panel) { this._panel.style.display = 'flex'; this._dirty = true; return; }
        const overlay = document.createElement('div');
        Object.assign(overlay.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)', zIndex: '1200' });
        const box = document.createElement('div');
        const bw = Math.min(1180, Math.max(560, window.innerWidth * 0.66));
        Object.assign(box.style, {
            position: 'absolute', left: Math.max(16, (window.innerWidth - bw) / 2) + 'px', top: '72px',
            width: bw + 'px', height: '78%',
            background: '#1e1e1e', color: '#dcdcdc', border: '1px solid #444', borderRadius: '8px',
            display: 'flex', flexDirection: 'column', fontFamily: 'Consolas, monospace', fontSize: '14px', overflow: 'hidden',
        });

        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#2d2d30', borderBottom: '1px solid #444', cursor: 'move', userSelect: 'none' });
        const title = document.createElement('div');
        title.textContent = 'CAN 总线分析仪 · LOOP1';
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '14px', color: '#4fc3f7', marginRight: 'auto' });
        head.appendChild(title);
        const mkBtn = (t, fn) => {
            const b = document.createElement('button'); b.textContent = t;
            Object.assign(b.style, { background: '#3a3a3d', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer' });
            b.onclick = fn; return b;
        };
        head.appendChild(mkBtn('清空', () => { this.captured = []; this._seq = 0; this._dirty = true; this._renderPanel(); }));
        this._btnPause = mkBtn('暂停', () => { this._capturing = !this._capturing; this._btnPause.textContent = this._capturing ? '暂停' : '继续'; });
        head.appendChild(this._btnPause);
        head.appendChild(mkBtn('关闭 ×', () => { overlay.style.display = 'none'; }));
        box.appendChild(head);

        // 面板拖动（按住标题栏拖动）
        let dragging = false, offX = 0, offY = 0;
        head.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            const r = box.getBoundingClientRect();
            offX = e.clientX - r.left; offY = e.clientY - r.top;
            e.preventDefault();
        });
        const onMove = (e) => {
            if (!dragging) return;
            box.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - offX)) + 'px';            box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offY)) + 'px';
        };
        const onUp = () => { dragging = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        this._dragCleanup = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        const body = document.createElement('div');
        Object.assign(body.style, { flex: '1', overflow: 'auto' });
        const cols = ['#', '时间', 'ID', '类型', '地址', 'DLC', '数据', '说明'];
        const colW = ['54px', '106px', '68px', '82px', '54px', '44px', '205px', 'auto'];
        const table = document.createElement('table');
        Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' });
        table.innerHTML = '<thead><tr>' + cols.map((h, i) => `<th style="position:sticky;top:0;background:#252526;color:#9cdcfe;text-align:left;padding:4px 8px;border-bottom:1px solid #444;width:${colW[i]}">${h}</th>`).join('') + '</tr></thead><tbody></tbody>';
        body.appendChild(table);
        this._tbody = table.querySelector('tbody');
        box.appendChild(body);

        const foot = document.createElement('div');
        Object.assign(foot.style, { padding: '6px 12px', background: '#2d2d30', borderTop: '1px solid #444', color: '#999' });
        this._foot = foot;
        box.appendChild(foot);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
        this._panel = overlay;
        this._dirty = true;
        this._renderPanel();
        this._timer = setInterval(() => { if (this._dirty) this._renderPanel(); this._updateFoot(); }, 500);
    }

    _renderPanel() {
        if (!this._tbody) return;
        this._dirty = false;
        const rows = this.captured.slice(0, 500).map((f) => {
            const dec = this._decode(f);
            const hex = (f.data || []).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            const td = (t, c, title) => `<td${title ? ` title="${title}"` : ''} style="padding:2px 8px;border-bottom:1px solid #2a2a2a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis${c ? ';' + c : ''}">${t}</td>`;
            return '<tr>'
                + td(f.seq != null ? f.seq : '')
                + td(this._fmtTime(f.timestamp))
                + td('0x' + f.id.toString(16).toUpperCase().padStart(3, '0'), 'color:#c586c0')
                + td(dec.type, 'color:#4ec9b0')
                + td('#' + dec.addr)
                + td((f.data || []).length)
                + td(hex, 'color:#dcdcaa')
                + td(dec.desc, 'color:#ce9178', String(dec.desc).replace(/"/g, '&quot;'))
                + '</tr>';
        }).join('');
        this._tbody.innerHTML = rows;
        this._updateFoot();
    }

    _updateFoot() {
        if (this._foot) this._foot.textContent = `帧数 ${this.captured.length}　·　总线：LOOP1　·　接口：${this.busConnected ? '已接入（抓包中）' : '未接入'}　·　${this._capturing ? '运行中' : '已暂停'}`;
    }

    closePanel() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._dragCleanup) { try { this._dragCleanup(); } catch (e) { /* ignore */ } this._dragCleanup = null; }
        if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
        this._panel = null;
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { ...this.config, ...cfg };
    }

    destroy() {
        this.closePanel();
        const bus = this.sys && this.sys.canBus;
        if (bus && typeof bus.removeSniffer === 'function') { try { bus.removeSniffer(this.id); } catch (e) { /* ignore */ } }
        super.destroy?.();
    }
}

export default CanAnalyzer;
