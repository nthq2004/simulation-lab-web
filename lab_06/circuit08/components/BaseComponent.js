export class BaseComponent {
    constructor(config, sys) {
        if (!sys) console.error(`组件 ${config.id} 缺少 sys 引用!`);
        this.sys = sys;
        this.config = config;
        this.id = config.id;
        this.scale = config.scale || 1;
        this._selected = false;

        this.group = new Konva.Group({
            x: config.x,
            y: config.y,
            rotation: config.rotation || 0,
            draggable: true,
            id: config.id,
        });

        this.ports = [];

        const handlePointClick = (e) => {
            this.sys.lastClickedId = this.id;
        };

        this.group.on('click tap', handlePointClick);

        let pressTimer;
        this.group.on('touchstart', (e) => {
            pressTimer = window.setTimeout(() => {
                this.showContextMenu(e.evt);
            }, 600);
        });
        this.group.on('touchend touchmove', () => {
            clearTimeout(pressTimer);
        });

        this.group.on('dragmove', () => {
            this.sys.redrawAll();
        });

        this.group.on('contextmenu', (e) => {
            e.evt.preventDefault();
            e.cancelBubble = true;
            this.showContextMenu(e.evt);
        });

        if (this.scale !== 1) {
            this.group.scale({ x: this.scale, y: this.scale });
        }

        this._cacheDirty = true;
    }

    markDirty() {
        this._cacheDirty = true;
    }

    _refreshIfDirty() {
        if (!this._cacheDirty) return;
        this._cacheDirty = false;
        this._forceCacheFlush();
    }

    _forceCacheFlush() {
        const target = this._staticGroup || this.group;
        if (!target) return;
        try {
            if (typeof target.clearCache === 'function') {
                target.clearCache();
                if (typeof target.cache === 'function') {
                    try {
                        const r = target.getClientRect({ relativeTo: target });
                        if (r && r.width > 0 && r.height > 0) {
                            target.cache({ x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height) });
                        }
                    } catch (e) {
                        try { target.cache(); } catch (err) { /* ignore */ }
                    }
                }
            }
        } catch (e) {
            console.warn('cache refresh failed', e);
        }
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _initGroups() {
        if (this._staticGroup) return;
        this._staticGroup   = new Konva.Group({ name: '_staticGroup' });
        this._dynamicGroup  = new Konva.Group({ name: '_dynamicGroup' });
        this._interactGroup = new Konva.Group({ name: '_interactGroup' });
        this.group.add(this._staticGroup);
        this.group.add(this._dynamicGroup);
        this.group.add(this._interactGroup);
    }

    addPort(x, y, id, type = 'wire', polarity = null, opacity = 1) {
        const composedId = `${this.id}_${type}_${id}`;

        if (type === 'pipe') {
            const fillColor = (polarity === 'in') ? '#ff0000' : '#1395eb';
            const pg = new Konva.Group({ x, y, name: composedId, opacity: opacity });

            const tube = new Konva.Rect({ x: -10, y: -6, width: 20, height: 12, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
            const seal = new Konva.Rect({ x: -8, y: -10, width: 16, height: 20, fill: '#7f8c8d', cornerRadius: 3 });
            const iface = new Konva.Rect({ x: -8, y: -8, width: 16, height: 16, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1 });

            pg.add(tube, seal, iface);

            pg.on('mouseenter', () => { pg.scale({ x: 1.06, y: 1.06 }); this.sys.stage.container().style.cursor = 'pointer'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
            pg.on('mouseleave', () => { pg.scale({ x: 1, y: 1 }); this.sys.stage.container().style.cursor = 'default'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });

            iface.hitStrokeWidth(15);

            iface.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this.sys.handlePortClick(this, composedId, 'pipe');
            });
            iface.on('click', (e) => {
                e.cancelBubble = true;
            });

            this.group.add(pg);
            this.ports.push({ id: composedId, origId: id, x, y, type: 'pipe', node: pg, parts: { tube, seal, iface } });
            return;
        }

        const fillColor = (polarity === 'p') ? '#ff0000' : '#130901';
        const port = new Konva.Circle({ x, y, radius: 6, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1, name: composedId, hitStrokeWidth: 15 });

        port.on('mouseenter', () => { port.radius(8); this.sys.stage.container().style.cursor = 'pointer'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
        port.on('mouseleave', () => { port.radius(6); this.sys.stage.container().style.cursor = 'default'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });

        port.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this.sys.handlePortClick(this, composedId, 'wire');
        });
        port.on('click', (e) => {
            e.cancelBubble = true;
        });

        this.group.add(port);
        this.ports.push({ id: composedId, origId: id, x, y, type: 'wire', polarity, node: port });
    }

    getAbsPortPos(portId) {
        const port = this.ports.find(p => p.id === portId);
        if (!port) return { x: 0, y: 0 };

        if (port.node && typeof port.node.getAbsolutePosition === 'function') {
            const pos = port.node.getAbsolutePosition();
            return { x: pos.x, y: pos.y };
        }

        try {
            const p = this.group.getAbsoluteTransform().point({ x: port.x || 0, y: port.y || 0 });
            return { x: p.x, y: p.y };
        } catch (e) {
            return { x: this.group.x() + (port.x || 0), y: this.group.y() + (port.y || 0) };
        }
    }

    showConfigDialog() {
        const fields = this.getConfigFields();

        const modal = document.createElement('div');
        modal.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 9999; font-family: sans-serif;
        `;

        const content = document.createElement('div');
        content.style = `
            background: white; padding: 20px; border-radius: 8px;
            width: 300px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        `;
        content.innerHTML = `<h3 style="margin-top:0">配置设备: ${this.id}</h3>`;

        const compactGap = fields.length > 8 ? '6px' : '15px';
        const inputs = {};
        fields.forEach(f => {
            const row = document.createElement('div');
            row.style = `margin-bottom: ${compactGap};`;
            const raw = this.config[f.key];
            const val = raw !== undefined && !Number.isNaN(raw) ? raw : '';

            let inputHtml = '';
            if (f.type === 'select') {
                const optionsHtml = f.options.map(opt => {
                    const isSelected = val == opt.value ? 'selected' : '';
                    return `<option value="${opt.value}" ${isSelected}>${opt.label}</option>`;
                }).join('');
                inputHtml = `
            <select id="diag_${f.key}"
                    style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px; background:white;">
                ${optionsHtml}
            </select>
        `;
            } else {
                const attrs = f.type === 'number' && (f.min !== undefined || f.max !== undefined || f.step !== undefined)
                    ? ` min="${f.min}" max="${f.max}" step="${f.step}"` : '';
                inputHtml = `
            <input type="${f.type || 'text'}" id="diag_${f.key}"
                   value="${val}"${attrs}
                   style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px;">
        `;
            }

            row.innerHTML = `
        <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${f.label}</label>
        ${inputHtml}
    `;
            content.appendChild(row);
            inputs[f.key] = f;
        });

        const btnRow = document.createElement('div');
        btnRow.style = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = '\u53D6\u6D88';
        cancelBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #eee; border-radius: 4px;';

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '\u4FDD\u5B58';
        saveBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #1395eb; color: white; border-radius: 4px;';

        cancelBtn.onclick = () => this.sys.container.removeChild(modal);

        saveBtn.onclick = () => {
            const newConfig = { ...this.config };
            fields.forEach(f => {
                const el = document.getElementById(`diag_${f.key}`);
                let val = el.value;
                if (f.type === 'number') val = parseFloat(val);
                newConfig[f.key] = val;
            });
            this.onConfigUpdate(newConfig);
            this.sys.container.removeChild(modal);
        };

        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelBtn.onclick();
            } else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
                e.preventDefault();
                saveBtn.onclick();
            }
        });

        requestAnimationFrame(() => {
            const first = content.querySelector('input, select');
            if (first) first.focus();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        content.appendChild(btnRow);
        modal.appendChild(content);
        this.sys.container.appendChild(modal);
    }

    getConfigFields() {
        return [
            { label: '\u5668\u4EF6\u540D\u79F0 (ID)', key: 'id', type: 'text' }
        ];
    }

    onConfigUpdate(newConfig) {
        console.log('\u914D\u7F6E\u5DF2\u66F4\u65B0:', newConfig);
        this.id = newConfig.id;
    }

    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;
    `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => {
                onClick();
                menu.remove();
            };
            return item;
        };

        menu.appendChild(createItem('\u5411\u53F3\u65CB\u8F6C 90\u00B0', () => this.rotate(90)));
        menu.appendChild(createItem('\u5411\u5DE6\u65CB\u8F6C 90\u00B0', () => this.rotate(-90)));
        menu.appendChild(createItem('\u53C2\u6570\u8BBE\u7F6E', () => this.showConfigDialog()));

        this.sys.container.appendChild(menu);

        const closeMenu = () => {
            menu.remove();
            window.removeEventListener('click', closeMenu);
        };
        window.addEventListener('click', closeMenu);
    }

    rotate(deltaDeg) {
        const currentRot = this.group.rotation();
        this.group.rotation(currentRot + deltaDeg);
        this.config.rotation = this.group.rotation();

        if (this.sys && typeof this.sys.updateLinePositions === 'function') this.sys.updateLinePositions();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // 选中/取消选中视觉反馈
    setSelected(selected) {
        this._selected = selected;

        if (this.group.isCached()) {
            this.group.clearCache();
        }

        let selRect = this.group.findOne('.selection-rect');
        if (selected) {
            const box = this.group.getClientRect({ relativeTo: this.group });
            if (!selRect) {
                selRect = new Konva.Rect({
                    x: box.x - 4,
                    y: box.y - 4,
                    width: box.width + 8,
                    height: box.height + 8,
                    stroke: '#3498db',
                    strokeWidth: 2,
                    dash: [5, 3],
                    name: 'selection-rect',
                    listening: false,
                });
                this.group.add(selRect);
            } else {
                selRect.x(box.x - 4);
                selRect.y(box.y - 4);
                selRect.width(box.width + 8);
                selRect.height(box.height + 8);
                selRect.show();
            }
        } else if (selRect) {
            selRect.hide();
        }

        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    highlight(active = true, color = '#f1c40f') {
        if (active && this.group.isCached()) {
            this.group.clearCache();
        }
        let glowRect = this.group.findOne('.glow-layer');

        if (!glowRect) {
            const box = this.group.getClientRect({ relativeTo: this.group });
            glowRect = new Konva.Rect({
                x: box.x - 5,
                y: box.y - 5,
                width: box.width + 10,
                height: box.height + 10,
                fill: color,
                opacity: 0,
                cornerRadius: 5,
                name: 'glow-layer',
                listening: false
            });
            this.group.add(glowRect);
            glowRect.moveToBottom();
        }

        if (active) {
            glowRect.to({
                opacity: 0.5,
                duration: 0.3,
                shadowColor: color,
                shadowBlur: 20,
                onFinish: () => {
                    this._runBreathEffect(glowRect, 0.5, 0.2);
                }
            });
        } else {
            if (this._breathAnim) this._breathAnim.stop();
            glowRect.to({
                opacity: 0,
                duration: 0.3,
                shadowBlur: 0,
                onFinish: () => {
                    this.group.cache();
                }
            });
        }

        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _runBreathEffect(node, maxOpacity, minOpacity) {
        if (this._breathAnim) this._breathAnim.stop();

        this._breathAnim = new Konva.Animation((frame) => {
            const period = 1000;
            const scale = (Math.sin(frame.time * 2 * Math.PI / period) + 1) / 2;
            node.opacity(minOpacity + (maxOpacity - minOpacity) * scale);
        }, this.sys.layer);

        this._breathAnim.start();
    }

    addClickablePart(partId, x, y, w, h) {
        var _this = this;
        var group = new Konva.Group({ x: x, y: y });

        var bg = new Konva.Rect({
            width: w, height: h,
            fill: 'rgba(0, 180, 0, 0.03)',
            stroke: null,
            listening: false,
        });

        var hit = new Konva.Rect({
            width: w, height: h,
            fill: 'rgba(0, 0, 0, 0)',
            stroke: null,
            listening: true,
            cursor: 'pointer',
        });

        hit.on('mouseenter', function() {
            bg.fill('rgba(0, 180, 0, 0.10)');
            _this.sys.layer.batchDraw();
        });
        hit.on('mouseleave', function() {
            bg.fill('rgba(0, 180, 0, 0.03)');
            _this.sys.layer.batchDraw();
        });

        hit.on('click tap', function(e) {
            e.cancelBubble = true;
            _this.sys.lastClickedId = _this.id;
            _this.sys.lastClickedPartId = _this.id + '/' + partId;

            var flash = new Konva.Rect({
                width: w, height: h,
                fill: 'rgba(0, 220, 0, 0.35)',
                opacity: 1,
            });
            group.add(flash);
            flash.to({
                opacity: 0,
                duration: 0.6,
                onFinish: function() { flash.destroy(); _this.sys.layer.batchDraw(); },
            });
            _this.sys.layer.batchDraw();
        });

        group.add(bg);
        group.add(hit);
        this._interactGroup.add(group);
    }

    hide() {
        this.group.hide();
        if (this.sys.wireNodes && Array.isArray(this.sys.wireNodes)) {
            this.sys.wireNodes.forEach(n => {
                const name = n.name ? n.name() : '';
                if (name.includes(this.id)) n.hide();
            });
        }
        this.sys.requestRedraw ? this.sys.requestRedraw() : this.sys.layer.draw();
    }
    show() {
        this.group.show();
        if (this.sys.wireNodes && Array.isArray(this.sys.wireNodes)) {
            this.sys.wireNodes.forEach(n => {
                const name = n.name ? n.name() : '';
                if (name.includes(this.id)) n.show();
            });
        }
        this.sys.requestRedraw ? this.sys.requestRedraw() : this.sys.layer.draw();
    }

    _refreshCache() {
        this._forceCacheFlush();
    }
}
