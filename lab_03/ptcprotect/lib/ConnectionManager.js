/**
 * ConnectionManager - 连线管理模块
 * 负责连线的增删、历史记录包装、动画连线，以及连线交互状态（起点/终点/虚线）
 */
export class ConnectionManager {
    /**
     * @param {object} sys - ControlSystem 实例，提供 comps / conns / history / lineLayer / layer / requestRedraw / redrawAll / requiredPipes
     */
    constructor(sys) {
        this.sys = sys;
    }

    // ─── 辅助工具 ────────────────────────────────────────────

    /** 无向比较：类型相同且端点集合相等（正向或反向均视为相同连接） */
    connEqual(a, b) {
        if (a.type !== b.type) return false;
        return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
    }

    /** 无向规范键：按字符串顺序对端点排序以保证正反向具有相同键 */
    connKeyCanonical(c) {
        const a = c.from;
        const b = c.to;
        return a <= b ? `${a}-${b}` : `${b}-${a}`;
    }

    // ─── 连线状态交互 ─────────────────────────────────────────

    /**
     * 处理端口点击事件：实现"起点-预览-终点"连线逻辑
     */
    handlePortClick(comp, portId, type) {
        const sys = this.sys;
        if (!sys.linkingState) {
            // 设定起点
            sys.linkingState = { comp, portId, type };
            sys.tempLine = new Konva.Line({
                stroke: type === 'wire' ? '#eb0d0d' : '#463aed',
                strokeWidth: type === 'wire' ? 2 : 12,
                opacity: 0.6, dash: [10, 5]
            });
            sys.layer.add(sys.tempLine);
            sys.requestRedraw();
        } else {
            // 设定终点
            if (sys.linkingState.type === type) {
                const aPort = sys.linkingState.portId;
                const bPort = portId;
                if (aPort === bPort) { this.resetLinking(); return; }

                const newConn = { from: aPort, to: bPort, type };

                // 1. 检查是否已经存在该连接（无论正反向）
                const exists = sys.conns.some(c => this.connEqual(c, newConn));
                if (exists) {
                    this.resetLinking();
                    return;
                }

                // 2. 管路冲突检查
                if (type === 'pipe') {
                    const isPortBusy = (pid) => sys.conns.filter(c => c.type === 'pipe').some(c => c.from === pid || c.to === pid);

                    if (isPortBusy(aPort)) {
                        alert(`端口 ${aPort} 已有管路连接`);
                        this.resetLinking();
                        return;
                    }
                    if (isPortBusy(bPort)) {
                        alert(`端口 ${bPort} 已有管路连接`);
                        this.resetLinking();
                        return;
                    }
                    // 对于管道类型的连接，根据 requiredPipes 强制标准方向
                    if (newConn.type === 'pipe') {
                        const required = sys.requiredPipes.find(r => this.connEqual(r, newConn));
                        if (required) {
                            newConn.from = required.from;
                            newConn.to = required.to;
                        }
                    }
                }
                // 3. 电路通常允许并联，不对 wire 做 isPortBusy 检查
                this.addConnWithHistory(newConn);
            } else {
                alert("类型不匹配：管路不能连接到电路！");
            }
            this.resetLinking();
        }
    }

    /** 取消当前连线操作，销毁虚线 */
    resetLinking() {
        const sys = this.sys;
        if (sys.tempLine) {
            sys.tempLine.destroy();
            sys.tempLine = null;
        }
        sys.linkingState = null;
        sys.requestRedraw();
    }

    // ─── 连线增删（带历史） ───────────────────────────────────

    /** 添加连接（可撤销） */
    addConnWithHistory(conn) {
        const sys = this.sys;
        const self = this;
        const action = {
            do() {
                if (!sys.conns.some(c => self.connEqual(c, conn))) sys.conns.push(conn);
                sys.redrawAll();
            },
            undo() {
                const idx = sys.conns.findIndex(c => self.connKeyCanonical(c) === self.connKeyCanonical(conn) && c.type === conn.type);
                if (idx !== -1) sys.conns.splice(idx, 1);
                sys.redrawAll();
            }
        };
        sys.history.do(action);
    }

    /** 添加连接（不可撤销） */
    addConn(conn) {
        const sys = this.sys;
        if (!sys.conns.some(c => this.connEqual(c, conn))) sys.conns.push(conn);
        sys.redrawAll();
    }

    /** 删除连接（可撤销） */
    removeConnWithHistory(conn) {
        const sys = this.sys;
        const self = this;
        const action = {
            do() {
                const idx = sys.conns.findIndex(c => self.connKeyCanonical(c) === self.connKeyCanonical(conn) && c.type === conn.type);
                if (idx !== -1) sys.conns.splice(idx, 1);
                sys.redrawAll();
            },
            undo() {
                if (!sys.conns.some(c => self.connEqual(c, conn))) sys.conns.push(conn);
                sys.redrawAll();
            }
        };
        sys.history.do(action);
    }

    /** 删除连接（不可撤销） */
    removeConn(conn) {
        const sys = this.sys;
        const idx = sys.conns.findIndex(c => this.connKeyCanonical(c) === this.connKeyCanonical(conn) && c.type === conn.type);
        if (idx !== -1) sys.conns.splice(idx, 1);
        sys.redrawAll();
    }

    // ─── 动画连线 ─────────────────────────────────────────────

    /**
     * 动画方式添加连线：3s 完成一次连线，结束后把连线加入 conns 并重绘（用于演示）
     */
    addConnectionAnimated(conn) {
        const sys = this.sys;
        return new Promise((resolve) => {
            const getPosByPort = (portId) => {
                const did = portId.split('_')[0];
                return sys.comps[did]?.getAbsPortPos(portId);
            };

            const fromPos = getPosByPort(conn.from);
            const toPos = getPosByPort(conn.to);

            if (!fromPos || !toPos) {
                console.error("Connection failed: Missing port coordinates", conn);
                sys.conns.push(conn);
                sys.redrawAll();
                return resolve();
            }

            const animLine = new Konva.Line({
                points: [fromPos.x, fromPos.y, fromPos.x, fromPos.y],
                stroke: conn.type === 'wire' ? '#e41c1c' : '#78e4c9',
                strokeWidth: conn.type === 'wire' ? 6 : 10,
                lineCap: 'round',
                lineJoin: 'round',
                shadowBlur: conn.type === 'pipe' ? 6 : 0,
                shadowColor: '#333',
                opacity: 0.95,
                listening: false
            });

            sys.lineLayer.add(animLine);

            const duration = 3000;
            const start = performance.now();
            let lastDrawTime = start;

            const animate = (now) => {
                const elapsed = now - start;
                const t = Math.min(1, elapsed / duration);
                const easeOut = 1 - Math.pow(1 - t, 3);

                const curX = fromPos.x + (toPos.x - fromPos.x) * easeOut;
                const curY = fromPos.y + (toPos.y - fromPos.y) * easeOut;

                animLine.points([fromPos.x, fromPos.y, curX, curY]);
                
                // 优化：每 16ms 才绘制一次（60fps）
                if (now - lastDrawTime >= 16) {
                    sys.lineLayer.batchDraw();
                    lastDrawTime = now;
                }

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    animLine.destroy();

                    const exists = sys.conns.some(c => c.from === conn.from && c.to === conn.to);
                    if (!exists) {
                        sys.conns.push(conn);
                    }

                    sys.redrawAll();
                    resolve();
                }
            };

            requestAnimationFrame(animate);
        });
    }
}
