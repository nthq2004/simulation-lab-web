/**
 * PageManager — 画布多页面管理（通用）
 *
 * 一个工程的所有组件在同一 Konva Stage 上创建，物理求解对全部组件运行；
 * 本模块只负责"显示哪一页"：
 *   · 页 0 为索引页（DOM 浮层卡片，点击跳转到任意页）；
 *   · 其余为电路页，按 PROJECT_PAGES 的 comps 列表显示/隐藏组件与连线。
 *
 * 导航：
 *   navigateTo(pageId)  直接跳到指定页
 *   goHome()            回到索引页（页 0）
 *   goBack() / goForward()  在"非索引电路页"之间按固定顺序**循环**前后移动
 *                            （页 1 → 页 2 → … → 末页 → 页 1 → …）
 *
 * 隐藏组件不参与渲染，但仍存在于 sys.comps 中并照常求解；连线按所属页显隐。
 */

export class PageManager {
    /**
     * @param {object} sys   ControlSystem 实例
     * @param {Array}  pages 页面定义（PROJECT_PAGES），形如：
     *        [{ id:0, name:'索引', type:'index' },
     *         { id:1, name:'中央监控计算机', comps:['cc','busc-cc'] },
     *         { id:2, name:'监测系统主电路', comps:[...] }]
     */
    constructor(sys, pages) {
        this.sys = sys;
        this.pages = Array.isArray(pages) ? pages.slice() : [];
        this.currentPage = 0;

        // 组件 id → 页码（供自动演示判断目标在第几页）
        this._compPage = {};
        this.pages.forEach(pg => {
            if (pg.type === 'index') return;
            (pg.comps || []).forEach(id => { this._compPage[id] = pg.id; });
        });

        // 索引页 DOM 浮层
        this._indexEl = null;

        // 电路页 id 的有序列表（用于循环前后）
        this._circuitPages = this.pages.filter(p => p.type !== 'index').map(p => p.id);
    }

    /** 某组件所属页码（找不到默认返回第一个电路页） */
    pageOf(compId) {
        return (compId in this._compPage) ? this._compPage[compId]
            : (this._circuitPages[0] !== undefined ? this._circuitPages[0] : 1);
    }

    /** 跳到指定页 */
    navigateTo(pageId) {
        pageId = Number(pageId);
        if (!this.pages.some(p => p.id === pageId)) return;
        if (pageId === this.currentPage && this._indexEl) return;
        this.currentPage = pageId;
        this._apply();
    }

    /** 回到索引页 */
    goHome() {
        const idx = this.pages.find(p => p.type === 'index');
        this.navigateTo(idx ? idx.id : 0);
    }

    /** 前一个电路页（循环） */
    goBack() {
        const list = this._circuitPages;
        if (!list.length) return;
        // 若当前在索引页，落到第一个电路页
        let i = list.indexOf(this.currentPage);
        if (i < 0) { this.navigateTo(list[0]); return; }
        i = (i - 1 + list.length) % list.length;
        this.navigateTo(list[i]);
    }

    /** 后一个电路页（循环） */
    goForward() {
        const list = this._circuitPages;
        if (!list.length) return;
        let i = list.indexOf(this.currentPage);
        if (i < 0) { this.navigateTo(list[0]); return; }
        i = (i + 1) % list.length;
        this.navigateTo(list[i]);
    }

    // ═══════════════════════════════════════════════════════════
    //  显隐应用
    // ═══════════════════════════════════════════════════════════

    _apply() {
        const sys = this.sys;
        const cur = this.currentPage;
        const pageDef = this.pages.find(p => p.id === cur);
        const isIndex = !!(pageDef && pageDef.type === 'index');

        if (isIndex) {
            // 索引页：隐藏全部组件与连线，只显示索引浮层
            for (const id in sys.comps) {
                const c = sys.comps[id];
                if (c && c.group) c.group.visible(false);
            }
            sys.comps && Object.values(sys.comps).forEach(c => {
                if (c && c.group) c.group.visible(false);
            });
            this._hideAllWires();
            this._showIndexPanel();
        } else {
            this._hideIndexPanel();
            this._applyComponentVisibility(cur);
            this._applyWireVisibility(cur);
        }

        if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
        // 立即重绘一次，避免隐藏节点残留到下一帧
        try { sys.layer.draw(); sys.lineLayer.draw(); } catch (e) { /* ignore */ }
    }

    _applyComponentVisibility(pageId) {
        const sys = this.sys;
        const pageDef = this.pages.find(p => p.id === pageId);
        const inPage = new Set(pageDef ? (pageDef.comps || []) : []);
        for (const id in sys.comps) {
            const c = sys.comps[id];
            if (!c || !c.group) continue;
            // 仪表：默认隐藏；仅在用户通过「选择仪表」调出后显示，且跨页常显。
            if (c._isInstrument) {
                c.group.visible(!!c._instrumentVisible);
                continue;
            }
            c.group.visible(inPage.has(id));
        }
    }

    _applyWireVisibility(pageId) {
        const sys = this.sys;
        // 判断一根连线是否属于当前页：两端组件都在本页
        const belongs = (conn) => {
            const a = compIdOf(conn.from);
            const b = compIdOf(conn.to);
            return this.pageOf(a) === pageId && this.pageOf(b) === pageId;
        };
        // 连线节点顺序与 Renderer 的过滤一致：pipe 3 节点/根、wire 1 节点/根
        this._setWireNodeVisibility(sys, belongs);
    }

    _hideAllWires() {
        const sys = this.sys;
        (sys.pipeNodes || []).forEach(n => n && n.visible && n.visible(false));
        (sys.wireNodes || []).forEach(n => n && n.visible && n.visible(false));
    }

    _setWireNodeVisibility(sys, belongs) {
        // pipe：每个 conn 对应 3 个节点
        const pipeConns = (sys.conns || []).filter(c => c.type === 'pipe');
        const pipeNodes = sys.pipeNodes || [];
        if (pipeNodes.length === pipeConns.length * 3) {
            pipeConns.forEach((conn, i) => {
                const v = belongs(conn);
                for (let k = 0; k < 3; k++) {
                    const n = pipeNodes[i * 3 + k];
                    if (n && n.visible) n.visible(v);
                }
            });
        }
        // wire：每个 conn 对应 1 个节点（含自定义 custom 线：使用 getAbsPortPos 判定）
        const wireConns = (sys.conns || []).filter(c => c.type === 'wire' && !c.custom);
        const wireNodes = sys.wireNodes || [];
        if (wireNodes.length === wireConns.length) {
            wireConns.forEach((conn, i) => {
                const n = wireNodes[i];
                if (n && n.visible) n.visible(belongs(conn));
            });
        }
    }

    /** 重新应用当前页（接线/隐藏变化后调用，例如自动接线完成） */
    refresh() { this._apply(); }

    // ═══════════════════════════════════════════════════════════
    //  索引页 DOM 浮层
    // ═══════════════════════════════════════════════════════════

    _showIndexPanel() {
        if (this._indexEl) { this._indexEl.style.display = 'flex'; return; }
        const sys = this.sys;
        const host = sys.container || document.body;

        const wrap = document.createElement('div');
        wrap.id = 'page-index-panel';
        Object.assign(wrap.style, {
            position: 'absolute', inset: '0', zIndex: '990',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '22px', fontFamily: 'Arial, sans-serif', pointerEvents: 'auto',
            background: 'linear-gradient(160deg,#eef3f7 0%,#dde6ee 100%)',
        });

        const title = document.createElement('div');
        title.textContent = '计算机控制系统常见故障及排除 · 页面索引';
        Object.assign(title.style, {
            fontSize: '26px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '6px',
        });
        wrap.appendChild(title);

        const sub = document.createElement('div');
        sub.textContent = '点击下方卡片进入对应页面   ·   工具栏 🏠 返回本页，← → 在电路页间循环切换';
        Object.assign(sub.style, { fontSize: '14px', color: '#62757f', marginBottom: '10px' });
        wrap.appendChild(sub);

        const grid = document.createElement('div');
        Object.assign(grid.style, {
            display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center',
            maxWidth: '900px',
        });

        this.pages.filter(p => p.type !== 'index').forEach(pg => {
            const card = document.createElement('div');
            Object.assign(card.style, {
                width: '300px', minHeight: '150px', background: '#fff', borderRadius: '12px',
                boxShadow: '0 6px 18px rgba(44,62,80,0.18)', border: '1px solid #cfd8dc',
                padding: '18px 20px', cursor: 'pointer', transition: 'transform .15s, box-shadow .15s',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            });
            card.onmouseenter = () => {
                card.style.transform = 'translateY(-4px)';
                card.style.boxShadow = '0 12px 26px rgba(44,62,80,0.28)';
                card.style.borderColor = '#1395eb';
            };
            card.onmouseleave = () => {
                card.style.transform = '';
                card.style.boxShadow = '0 6px 18px rgba(44,62,80,0.18)';
                card.style.borderColor = '#cfd8dc';
            };

            const h = document.createElement('div');
            h.textContent = `${pg.id}. ${pg.name}`;
            Object.assign(h.style, { fontSize: '18px', fontWeight: 'bold', color: '#1395eb' });
            card.appendChild(h);

            const d = document.createElement('div');
            d.textContent = pg.desc || '';
            Object.assign(d.style, { fontSize: '13px', color: '#546e7a', lineHeight: '1.5', marginTop: '8px', flex: '1' });
            card.appendChild(d);

            const go = document.createElement('div');
            go.textContent = '进入 →';
            Object.assign(go.style, { fontSize: '13px', color: '#2e7d32', fontWeight: 'bold', marginTop: '10px' });
            card.appendChild(go);

            card.onclick = () => this.navigateTo(pg.id);
            grid.appendChild(card);
        });

        wrap.appendChild(grid);
        host.appendChild(wrap);
        this._indexEl = wrap;
    }

    _hideIndexPanel() {
        if (this._indexEl) this._indexEl.style.display = 'none';
    }
}

/** 从端口 id 解析组件 id：`{compId}_wire_{port}` / `{compId}_pipe_{port}` */
function compIdOf(portId) {
    if (!portId) return '';
    const s = String(portId);
    if (s.includes('_wire_')) return s.split('_wire_')[0];
    if (s.includes('_pipe_')) return s.split('_pipe_')[0];
    return s.split('_')[0];
}
