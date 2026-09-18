/**
 * BaseComponent 是整个仿真组件体系的基础类。
 *
 * 作用概述：
 * 1. 为每个可视化器件提供统一的 Konva 图形容器与生命周期管理；
 * 2. 负责端口创建、组件拖拽、右键菜单、选中高亮、缓存刷新等基础交互逻辑；
 * 3. 作为所有子类的父类，统一约定组件绘制、配置、显示与隐藏的标准接口；
 * 4. 让不同电气设备、气动组件、数字模块等都能以同样的方式接入系统。
 *
 * 这个类本身不代表某个具体器件，而是所有器件的共用骨架。
 * 它定义了：组件根 group、静态层、动态层、交互层、端口、缓存和事件处理等核心能力，
 * 子类通过继承并补充自己的图形与物理模型来实现具体设备功能。
 */
export class BaseComponent {
    constructor(config, sys) {
        // 如果缺少系统引用，则输出错误日志，说明该组件无法正确接入控制系统。
        if (!sys) console.error(`组件 ${config.id} 缺少 sys 引用!`);
        // 保存系统实例，后续可通过 this.sys 调用全局重绘、端口点击处理、容器等能力。
        this.sys = sys;
        // 保存原始配置对象，便于后续读取和回写参数。
        this.config = config;
        // 组件唯一标识符，用于端口命名、状态查询、展示和连接管理。
        this.id = config.id;
        // 缩放比例，决定组件在视图中显示大小，默认不缩放为 1。
        this.scale = config.scale || 1;
        // 记录当前组件是否被选中，用于绘制蓝色选择框和状态显示。
        this._selected = false;

        // 创建一个根 Konva.Group，作为整个组件的容器，负责平移、旋转和拖拽。
        this.group = new Konva.Group({
            x: config.x,
            y: config.y,
            rotation: config.rotation || 0,
            draggable: true,
            id: config.id,
        });

        // 端口列表，保存组件所有电气/气动端口的信息，用于连接与位置查询。
        this.ports = [];

        // 单击组件时记录最新被点击的目标组件 ID，供上层逻辑进行状态同步。
        const handlePointClick = (e) => {
            this.sys.lastClickedId = this.id;
        };

        // 绑定点击事件，支持鼠标和触屏环境。
        this.group.on('click tap', handlePointClick);

        // 处理长按触摸操作：按住 600ms 后弹出右键菜单，模拟桌面端右键交互。
        let pressTimer;
        this.group.on('touchstart', (e) => {
            pressTimer = window.setTimeout(() => {
                this.showContextMenu(e.evt);
            }, 600);
        });
        this.group.on('touchend touchmove', () => {
            clearTimeout(pressTimer);
        });

        // 拖拽时通知系统重绘所有线条和组件，保持画面同步。
        this.group.on('dragmove', () => {
            this.sys.redrawAll();
        });

        // 右键点击时阻止浏览器默认菜单，并显示组件上下文菜单。
        this.group.on('contextmenu', (e) => {
            e.evt.preventDefault();
            e.cancelBubble = true;
            this.showContextMenu(e.evt);
        });

        // 如果有缩放比例，则对整个组件做等比例缩放处理。
        if (this.scale !== 1) {
            this.group.scale({ x: this.scale, y: this.scale });
        }

        // 标记初始缓存为脏状态，确保首次渲染或者组件更新后会刷新缓存。
        this._cacheDirty = true;
    }

    // 设置该组件为“脏状态”，表示需要重新生成缓存或重绘。
    markDirty() {
        this._cacheDirty = true;
    }

    // 当组件处于脏状态时调用，执行缓存刷新操作。
    _refreshIfDirty() {
        if (!this._cacheDirty) return;
        this._cacheDirty = false;
        this._forceCacheFlush();
    }

    // 强制刷新组件的缓存，常用于图形变化之后重新生成静态位图缓存。
    _forceCacheFlush() {
        // 优先使用静态组缓存；如果没有静态组，则退回到整个组件 group。
        const target = this._staticGroup || this.group;
        if (!target) return;
        try {
            // 若目标支持 clearCache，则先清理旧缓存，再重建新缓存。
            if (typeof target.clearCache === 'function') {
                target.clearCache();
                // 若目标支持 cache，则重新缓存当前可见图形，按实际矩形尺寸计算。
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
        // 结束后触发系统重绘，确保画布状态最新。
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // 初始化组件的三层分组：静态层、动态层、交互层。
    _initGroups() {
        // 避免重复初始化，确保一个组件只创建一次分组对象。
        if (this._staticGroup) return;
        // 静态层：不常变化的图形，如底座、外壳、指示文字等。
        this._staticGroup   = new Konva.Group({ name: '_staticGroup' });
        // 动态层：需要定时更新的内容，如数值显示、状态指示灯、旋钮等。
        this._dynamicGroup  = new Konva.Group({ name: '_dynamicGroup' });
        // 交互层：用于点击热区、拖拽透明区域、动态高亮等交互效果。
        this._interactGroup = new Konva.Group({ name: '_interactGroup' });
        // 把三层挂到组件根 group 下，层级清晰，便于更新和管理。
        this.group.add(this._staticGroup);
        this.group.add(this._dynamicGroup);
        this.group.add(this._interactGroup);
    }

    // 创建电气接口或气动接口，统一维护端口列表和事件处理。
    addPort(x, y, id, type = 'wire', polarity = null, opacity = 1) {
        // 组合端口唯一 ID，规则为：组件 ID + 类型 + 端口名。
        const composedId = `${this.id}_${type}_${id}`;

        // 气动端口采用矩形壳体样式，并用颜色区分输入/输出方向。
        if (type === 'pipe') {
            const fillColor = (polarity === 'in') ? '#ff0000' : '#1395eb';
            const pg = new Konva.Group({ x, y, name: composedId, opacity: opacity });

            const tube = new Konva.Rect({ x: -10, y: -6, width: 20, height: 12, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
            const seal = new Konva.Rect({ x: -8, y: -10, width: 16, height: 20, fill: '#7f8c8d', cornerRadius: 3 });
            const iface = new Konva.Rect({ x: -8, y: -8, width: 16, height: 16, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1 });

            pg.add(tube, seal, iface);

            // 鼠标悬浮时放大端口并改变光标，增强可点击感。
            pg.on('mouseenter', () => { pg.scale({ x: 1.06, y: 1.06 }); this.sys.stage.container().style.cursor = 'pointer'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
            pg.on('mouseleave', () => { pg.scale({ x: 1, y: 1 }); this.sys.stage.container().style.cursor = 'default'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });

            iface.hitStrokeWidth(15);

            // 气动端口点击事件转发给系统统一处理，执行连线或断开逻辑。
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

        // 电气端口使用圆形节点，正极和负极使用不同颜色区分极性。
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

        // 把端口节点加入组件 group，并记录到 ports 数组中，供后续连线和定位使用。
        this.group.add(port);
        this.ports.push({ id: composedId, origId: id, x, y, type: 'wire', polarity, node: port });
    }

    // 通过端口 ID 获取其在画布中的绝对坐标，便于连线和线路计算。
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

    // 显示组件参数配置对话框，允许用户修改其配置字段。
    showConfigDialog() {
        // 获取所有可配置字段，子类可通过重写 getConfigFields() 来扩展。
        const fields = this.getConfigFields();

        // 创建遮罩层，模拟弹窗浮层，阻止底层画布交互。
        const modal = document.createElement('div');
        modal.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 9999; font-family: sans-serif;
        `;

        // 创建内容容器，负责显示表单和按钮。
        const content = document.createElement('div');
        content.style = `
            background: white; padding: 20px; border-radius: 8px;
            width: 300px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        `;
        content.innerHTML = `<h3 style="margin-top:0">配置设备: ${this.id}</h3>`;

        // 若字段较多，压缩行间距，避免弹窗过高。
        const compactGap = fields.length > 8 ? '6px' : '15px';
        const inputs = {};
        fields.forEach(f => {
            const row = document.createElement('div');
            row.style = `margin-bottom: ${compactGap};`;
            const raw = f.get ? f.get(this) : this.config[f.key];
            const val = raw !== undefined && !Number.isNaN(raw) ? raw : '';

            let inputHtml = '';
            // 对下拉框字段单独生成 option 列表，并根据当前值设置 selected。
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
                // 对数值字段根据 min/max/step 生成 HTML 属性，便于限制输入范围。
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

        // 底部按钮区域，提供取消和保存两种操作。
        const btnRow = document.createElement('div');
        btnRow.style = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = '取消';
        cancelBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #eee; border-radius: 4px;';

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '保存';
        saveBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #1395eb; color: white; border-radius: 4px;';

        // 点击取消时移除弹窗，恢复底层界面交互。
        cancelBtn.onclick = () => this.sys.container.removeChild(modal);

        // 点击保存时读取表单中的新值，并更新相关配置。
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

        // 绑定键盘快捷键，支持 Esc 关闭和 Enter 提交。
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelBtn.onclick();
            } else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
                e.preventDefault();
                saveBtn.onclick();
            }
        });

        // 让弹窗获得焦点，提升交互体验。
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

    // 默认配置字段：至少提供设备 ID 作为可编辑字段。
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' }
        ];
    }

    // 默认配置更新处理：只更新组件 ID，并输出日志。
    onConfigUpdate(newConfig) {
        console.log('配置已更新:', newConfig);
        this.id = newConfig.id;
    }

    // 在组件上显示右键菜单，提供旋转和参数设置等常用操作。
    showContextMenu(evt) {
        // 删除旧菜单，避免重复出现多个菜单实例。
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        // 创建菜单容器并设置样式。
        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;
    `;

        // 统一创建菜单项，简化不同功能的添加过程。
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

        // 默认菜单项：顺时针和逆时针旋转，以及打开参数设置窗口。
        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));

        // 子类自定义右键菜单项
        if (typeof this.getContextMenuItems === 'function') {
            this.getContextMenuItems().forEach(it => menu.appendChild(createItem(it.label, it.onClick)));
        }

        this.sys.container.appendChild(menu);

        // 点击页面其他位置则关闭菜单，避免菜单残留。
        const closeMenu = () => {
            menu.remove();
            window.removeEventListener('click', closeMenu);
        };
        window.addEventListener('click', closeMenu);
    }

    // 旋转组件，并同步更新配置中的 rotation 值和连线位置。
    rotate(deltaDeg) {
        const currentRot = this.group.rotation();
        this.group.rotation(currentRot + deltaDeg);
        this.config.rotation = this.group.rotation();

        // 旋转后需要同步更新连线位置，确保端口连接与图形方向一致。
        if (this.sys && typeof this.sys.updateLinePositions === 'function') this.sys.updateLinePositions();
        // 请求重绘，刷新画布立刻显示旋转结果。
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // 选中/取消选中视觉反馈
    setSelected(selected) {
        this._selected = selected;

        // 如果当前 group 已被缓存，先清除旧缓存，防止选择框残留在位图中。
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

    // 高亮组件：用于教学演示、选中提醒、故障定位等场景。
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
                    // 注意：不能对整体 group 做缓存——那会将该时刻的动态内容
                    // （LCD 数值、按钮、指示灯、旋钮等）固化为位图，此后不再重绘。
                    // cache='fixed' 的组件已有 _staticGroup 静态缓存，动态组照常每帧刷新；
                    // 仅对未启用 fixed 缓存的纯静态组件保留整体缓存以维持性能。
                    if (this.cache !== 'fixed') this.group.cache();
                }
            });
        }

        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // 运行呼吸式高亮动画，让组件看起来像在“脉动”提示用户关注。
    _runBreathEffect(node, maxOpacity, minOpacity) {
        if (this._breathAnim) this._breathAnim.stop();

        this._breathAnim = new Konva.Animation((frame) => {
            const period = 1000;
            const scale = (Math.sin(frame.time * 2 * Math.PI / period) + 1) / 2;
            node.opacity(minOpacity + (maxOpacity - minOpacity) * scale);
        }, this.sys.layer);

        this._breathAnim.start();
    }

    // 为组件某个局部区域增加可点击“部件热区”，支持精确识别具体部件。
    addClickablePart(partId, x, y, w, h, onTop = false) {
        var _this = this;
        var group = new Konva.Group({ x: x, y: y });

        // 半透明背景用于提示点击区域位置，便于演示时显示目标区域。
        var bg = new Konva.Rect({
            width: w, height: h,
            fill: 'rgba(0, 180, 0, 0.03)',
            stroke: null,
            listening: false,
        });

        // 可点击的矩形命中区，用于实际响应用户点击。
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

            // 点击后生成绿色闪烁效果，提示该部件已被选中。
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
        if (onTop) group.moveToTop();   // 提升到交互层最上，避免被同层较大热区（如门板 door）遮挡
        return hit;   // 返回命中区，调用方可追加自定义点击行为
    }

    // 隐藏组件，并同步隐藏其相关连线，适用于故障、关停或教学步骤控制。
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

    // 显示组件，并恢复其相关连线的显示。
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

    // 对外提供缓存刷新接口，供子类和系统统一调用。
    _refreshCache() {
        this._forceCacheFlush();
    }
}
