import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PlcInternalMonitor — PLC 内部位监视表（第 2 页）
 *
 * 逐行列出 S7-200 SMART 的内部标志位 M 与定时器 T 的实时状态与含义：
 *   · M0.0 起，只列本工程实际用到的 M 位（无用的空位不再占行）
 *   · T101 ~ T110：显示触点状态 + 当前值/设定值（100 ms 时基）
 * 数据直接读 `sys.s7200Solver.getProcessImage('plc-1')`，与 CPU 组件同源。
 */

const M_ROWS = [
    ['M0.0', '风压正常'], ['M0.1', '报警汇总'], ['M0.2', '自动运行'],
    ['M0.3', '预扫风完成'], ['M0.4', '点火结束'], ['M0.5', '小火稳定结束'],
    ['M1.0', '水位低消声'], ['M1.1', '油温低消声'], ['M1.2', '风机失压消声'],
    ['M1.3', '超压消声'], ['M1.4', '熄火消声'], ['M1.5', '点火失败消声'],
    ['M1.6', '水位高消声'],
    ['M2.0', '油泵运行'], ['M2.1', '进油使能'],
    ['M3.0', '点火位置完成'], ['M3.1', '点火准备完成'], ['M3.2', '曾建立火焰'],
];

const T_ROWS = [
    [101, '预扫风'], [102, '点火'], [103, '小火稳定'], [104, '后扫风'],
    [105, '点火超时'], [106, '点火监视'], [107, '手动点火'], [108, '风压检测'],
    [109, '点火位置'], [110, '点火准备'],
];

const PITCH = 26;

export class PlcInternalMonitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(140, config.width || 178);
        this.H = Math.max(520, config.height || 820);
        this.type = 'plc_internal_monitor';
        this.cache = 'fixed';

        this._initGroups();
        this._draw();
        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _plcImg() {
        const sol = this.sys && this.sys.s7200Solver;
        if (!sol || typeof sol.getProcessImage !== 'function') return null;
        try { return sol.getProcessImage('plc-1'); } catch (e) { return null; }
    }

    _label(g, x, y, text, size, fill, bold = false, align = 'left', width = 0) {
        const o = {
            x, y, text, fontSize: size, fill, align,
            fontStyle: bold ? 'bold' : 'normal',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
    }

    _draw() {
        const g = this._staticGroup, W = this.W, H = this.H;
        const yM = 50;
        const yT = yM + M_ROWS.length * PITCH + 18;

        // 面板
        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: H, cornerRadius: 8, fill: '#f7f9fa', stroke: '#90a4ae', strokeWidth: 1.6 }));
        g.add(new Konva.Rect({ x: 4, y: 4, width: W - 8, height: 28, cornerRadius: 4, fill: '#e3eaf0', stroke: '#b0bec5', strokeWidth: 1 }));
        this._label(g, 8, 8, 'PLC 内部位状态', 12, '#1b3a4b', true);

        this._label(g, 8, yM - 22, 'M 内部标志位', 12, '#1565c0', true);
        M_ROWS.forEach(([addr, mean], i) => {
            const y = yM + i * PITCH;
            this._label(g, 8, y, addr, 13, '#37474f');
            this._label(g, 58, y, mean, 13, '#0c0c0c', false, 'left', W - 64);
        });

        g.add(new Konva.Line({ points: [6, yT - 16, W - 6, yT - 16], stroke: '#cfd8dc', strokeWidth: 1 }));
        this._label(g, 8, yT - 10, 'T 定时器（值/设定）', 12, '#c62828', true);

        T_ROWS.forEach(([no, mean], i) => {
            const y = yT + 12 + i * PITCH;
            this._label(g, 8, y, `T${no}`, 13, '#37474f');
            this._label(g, 58, y, mean, 13, '#05a8fa', false, 'left', 60);
        });

        this._rowGeom = { pitch: PITCH, yM, yT };
    }

    tick() {
        const img = this._plcImg();
        const G = this._rowGeom;
        if (!img || !G) return;

        const d = this._dynamicGroup;
        if (!this._mamps) {
            this._mamps = M_ROWS.map(([addr], i) => {
                const [by, bt] = addr.slice(1).split('.').map(Number);
                const c = new Konva.Circle({
                    x: 48, y: G.yM + i * G.pitch + 8, radius: 5,
                    fill: '#2b2f2f', stroke: '#111', strokeWidth: 1,
                });
                d.add(c);
                return { node: c, idx: by * 8 + bt };
            });
            this._tamps = T_ROWS.map(([no], i) => {
                const c = new Konva.Circle({
                    x: 48, y: G.yT + 12 + i * G.pitch + 8, radius: 5,
                    fill: '#2b2f2f', stroke: '#111', strokeWidth: 1,
                });
                const t = new Konva.Text({
                    x: this.W - 62, y: G.yT + 12 + i * G.pitch + 2, width: 54, text: '—',
                    fontSize: 12, align: 'right', fill: '#455a64',
                    fontFamily: 'Consolas, "Microsoft YaHei", monospace',
                });
                d.add(c, t);
                return { node: c, txt: t, no };
            });
        }

        const M = img.M || [];
        this._mamps.forEach(o => o.node.fill(M[o.idx] ? '#00e676' : '#2b2f2f'));
        const T = img.T || [];
        this._tamps.forEach(o => {
            const t = T[o.no];
            o.node.fill(t && t.bit ? '#ffb300' : '#2b2f2f');
            o.txt.text(t ? `${Math.round(t.cur || 0)}/${t.preset || 0}` : '—');
        });

        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text', get: c => c.id },
            { label: '宽度', key: 'width', type: 'number', get: c => c.W },
            { label: '高度', key: 'height', type: 'number', get: c => c.H },
        ];
    }

    onConfigUpdate(cfg) {
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

export default PlcInternalMonitor;
