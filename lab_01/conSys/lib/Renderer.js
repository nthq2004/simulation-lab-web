/**
 * Renderer - 渲染引擎模块
 * 负责连线（管路/电路）的绘制、增量位置更新
 */
export class Renderer {
    /**
     * @param {object} sys - ControlSystem 实例
     */
    constructor(sys) {
        this.sys = sys;
    }

    // ─── 公共入口 ─────────────────────────────────────────────

    /** 统一重绘接口：当组件移动或连接池改变时调用 */
    redrawAll() {
        const sys = this.sys;
        this._renderGroup(sys.conns.filter(c => c.type === 'pipe'), 'pipe');
        this._renderGroup(sys.conns.filter(c => c.type === 'wire'), 'wire');
    }

    /** 增量更新现有线条节点的位置（避免销毁重建） */
    updateLinePositions() {
        const sys = this.sys;
        const getPosByPort = (portId) => {
            const did = portId.split('_')[0];
            return sys.comps[did]?.getAbsPortPos(portId);
        };

        // 更新 pipeNodes：每个 conn 对应 3 个节点（line, flow, handle）
        const pipeConns = sys.conns.filter(c => c.type === 'pipe');
        if (sys.pipeNodes.length === pipeConns.length * 3) {
            for (let i = 0; i < pipeConns.length; i++) {
                const conn = pipeConns[i];
                const p1 = getPosByPort(conn.from);
                const p2 = getPosByPort(conn.to);
                if (!p1 || !p2) continue;
                const baseIdx = i * 3;
                const line = sys.pipeNodes[baseIdx];
                const flow = sys.pipeNodes[baseIdx + 1];
                const handle = sys.pipeNodes[baseIdx + 2];
                let pts = [p1.x, p1.y, p2.x, p2.y];
                if (conn.midPoint) pts = [p1.x, p1.y, conn.midPoint.x, conn.midPoint.y, p2.x, p2.y];
                try { line.points(pts); flow.points(pts); handle.position(conn.midPoint || { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }); } catch (e) { }
            }
        } else {
            sys._needsRedraw = true;
        }

        // 更新 wireNodes：每个 conn 对应 1 个节点
        const wireConns = sys.conns.filter(c => c.type === 'wire');
        if (sys.wireNodes.length === wireConns.length) {
            for (let i = 0; i < wireConns.length; i++) {
                const conn = wireConns[i];
                const p1 = getPosByPort(conn.from);
                const p2 = getPosByPort(conn.to);
                if (!p1 || !p2) continue;
                const node = sys.wireNodes[i];
                try {
                    if (conn.from.includes('multimeter') || conn.to.includes('multimeter')) {
                        const midX = (p1.x + p2.x) / 2;
                        const midY = Math.max(p1.y, p2.y) + 20;
                        node.points([p1.x, p1.y, midX, midY, p2.x, p2.y]);
                    } else {
                        const pts = this._calcWirePoints(sys.conns, conn, p1, p2);
                        node.points(pts);
                    }
                } catch (e) { }
            }
        } else {
            sys._needsRedraw = true;
        }
    }

    // ─── 私有实现 ─────────────────────────────────────────────

    _renderGroup(conns, type) {
        const sys = this.sys;
        const nodesRef = type === 'pipe' ? 'pipeNodes' : 'wireNodes';
        sys[nodesRef].forEach(n => n.destroy());
        sys[nodesRef] = [];

        const getPosByPort = (portId) => {
            const did = portId.split('_')[0];
            return sys.comps[did]?.getAbsPortPos(portId);
        };

        conns.forEach(conn => {
            const p1 = getPosByPort(conn.from);
            const p2 = getPosByPort(conn.to);
            if (!p1 || !p2) return;

            let line;
            if (type === 'pipe') {
                line = this._drawPipe(conn, p1, p2, sys, nodesRef);
            } else {
                line = this._drawWire(conn, p1, p2, sys, nodesRef);
            }
            line.moveToBottom();
        });
        sys.lineLayer.batchDraw();
    }

    _drawPipe(conn, p1, p2, sys, nodesRef) {
        let pts = [p1.x, p1.y, p2.x, p2.y];
        if (conn.midPoint) {
            pts = [p1.x, p1.y, conn.midPoint.x, conn.midPoint.y, p2.x, p2.y];
        }

        const line = new Konva.Line({
            points: pts,
            stroke: '#c4c7c8',
            strokeWidth: 16,
            lineCap: 'round',
            lineJoin: 'round'
        });
        const flow = new Konva.Line({
            points: pts,
            stroke: '#130cdf',
            strokeWidth: 4,
            dash: [10, 20],
            name: 'flow',
            lineJoin: 'round',
            visible: false
        });

        const handlePos = conn.midPoint || { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const handle = new Konva.Circle({
            x: handlePos.x, y: handlePos.y,
            radius: 6, fill: '#f1c40f',
            stroke: '#d35400', strokeWidth: 2,
            draggable: true, visible: false
        });

        handle.on('dragmove', () => {
            conn.midPoint = { x: handle.x(), y: handle.y() };
            const newPts = [p1.x, p1.y, handle.x(), handle.y(), p2.x, p2.y];
            line.points(newPts);
            flow.points(newPts);
        });
        handle.on('dragend', () => { sys.redrawAll(); });

        const showHandle = () => { handle.visible(true); if (sys.requestRedraw) sys.requestRedraw(); };
        const hideHandle = () => { if (!handle.isDragging()) handle.visible(false); if (sys.requestRedraw) sys.requestRedraw(); };
        line.on('mouseenter', showHandle);
        line.on('mouseleave', hideHandle);
        handle.on('mouseenter', showHandle);
        handle.on('mouseleave', hideHandle);

        const key = sys.connMgr.connKeyCanonical(conn);
        flow.setAttr('connKey', key);
        const removeHandler = () => {
            const existing = sys.conns.find(c => sys.connMgr.connKeyCanonical(c) === key && c.type === 'pipe');
            if (existing) sys.connMgr.removeConnWithHistory(existing);
        };
        line.on('dblclick', removeHandler);
        flow.on('dblclick', removeHandler);
        handle.on('dblclick', removeHandler);

        sys.lineLayer.add(line, flow, handle);
        sys[nodesRef].push(line, flow, handle);

        line.moveToBottom();
        flow.moveToBottom();

        return line;
    }

    _drawWire(conn, p1, p2, sys, nodesRef) {
        let line;

        if (conn.from.includes('multimeter') || conn.to.includes('multimeter')) {
            // 万用表特殊连线逻辑
            let strokeColor;
            const midX = (p1.x + p2.x) / 2;
            const midY = Math.max(p1.y, p2.y) + 20;
            const linePoints = [p1.x, p1.y, midX, midY, p2.x, p2.y];

            if (conn.from.includes('com') || conn.to.includes('com')) {
                strokeColor = '#006400';
            } else if (conn.from.includes('wire_v') || conn.to.includes('wire_v') || conn.from.includes('wire_ma') || conn.to.includes('wire_ma')) {
                strokeColor = '#FF4500';
            }
            line = new Konva.Line({
                points: linePoints,
                stroke: strokeColor,
                strokeWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
                tension: 0.4,
            });
        } else {
            const pts = this._calcWirePoints(sys.conns, conn, p1, p2);
            let stroke;
            if (conn.from.endsWith('p') || conn.to.endsWith('p') || conn.from.includes('wire_a')) stroke = '#e60c0c';
            else stroke = '#544f4f';
            line = new Konva.Line({
                points: pts,
                stroke: stroke, strokeWidth: 4, bezier: true
            });
        }

        const key = sys.connMgr.connKeyCanonical(conn);
        const type = 'wire';
        line.setAttr('connKey', key);
        line.setAttr('connType', type);
        line.on('dblclick', () => {
            const existing = sys.conns.find(c => sys.connMgr.connKeyCanonical(c) === key && c.type === type);
            if (existing) {
                sys.connMgr.removeConnWithHistory(existing);
            }
        });
        sys.lineLayer.add(line);
        sys[nodesRef].push(line);

        return line;
    }

    /** 计算电线贝塞尔控制点（含多线并排偏移） */
    _calcWirePoints(allConns, conn, p1, p2) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = -dy / len;
        const uy = dx / len;

        const devA = conn.from.split('_')[0];
        const devB = conn.to.split('_')[0];
        const siblings = allConns.filter(c => c.type === 'wire' && (() => {
            const ca = c.from.split('_')[0];
            const cb = c.to.split('_')[0];
            return (ca === devA && cb === devB) || (ca === devB && cb === devA);
        })());

        const self = this;
        const idx = siblings.findIndex(c => self.sys.connMgr.connKeyCanonical(c) === self.sys.connMgr.connKeyCanonical(conn));
        const total = siblings.length || 1;
        const spacing = 18;
        const longSpacing = 8;
        const offset = (idx - (total - 1) / 2) * spacing;
        const longOffset = (idx - (total - 1) / 2) * longSpacing;

        const controlX = midX + ux * offset + (dx / len) * longOffset;
        const controlY = midY + uy * offset + (dy / len) * longOffset;

        return [p1.x, p1.y, controlX, controlY, controlX, controlY, p2.x, p2.y];
    }
}
