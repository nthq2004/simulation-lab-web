## Exploration: ControlSystem class architecture, component system, simulation engines

Found 260 symbols across 135 files.

### Blast radius — what depends on these (update/verify before editing)

- `ControlSystem` (consys.js:32) — 1 caller in `main.js`; ⚠️ no covering tests found
- `BaseComponent` (components/BaseComponent.js:1) — 249 callers in `can/AI.js`, `can/AO.js`, `can/BUSCON.js`, `can/CentralComputer.js` +245 more; ⚠️ no covering tests found
- `simulateShunt` (components/LVCircuitBreakerPrinciple.js:1191) — 2 callers in `components/LVCircuitBreakerPrinciple.js`; ⚠️ no covering tests found
- `simulateTarget` (components/PIRSensor.js:1219) — 2 callers in `components/PIRSensor.js`; ⚠️ no covering tests found
- `Engine` (components/Engine.js:3) — 3 callers in `consys.js`, `export.js`, `project/flowmeter.js`; ⚠️ no covering tests found

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### components/LVCircuitBreakerPrinciple.js — calls(calls), BaseComponent(extends), simulateUndervoltage(method), simulateUndervoltage(calls), simulateThermal(method), simulateThermal(calls), +1 more

```javascript
74	 *  terminal_l1_out — 主回路 L1 出线
75	 *  terminal_ctrl   — 分励脱扣器控制信号输入
76	 */
77	export class LVCircuitBreakerPrinciple extends BaseComponent {
78	    constructor(config, sys) {
79	        super(config, sys);
80	

... (gap) ...

1173	    }
1174	
1175	    /** 模拟欠压脱扣 */
1176	    simulateUndervoltage() {
1177	        if (this._state !== 'CLOSED') { this.close(); setTimeout(() => this.simulateUndervoltage(), 400); return; }
1178	        this.supplyVoltage = 0;
1179	        this._uvPlunger = 0;
1180	        this._triggerTrip('UNDERVOLTAGE');
1181	    }
1182	
1183	    /** 模拟热脱扣（注入 2.5×额定电流，等待热积累） */
1184	    simulateThermal(multiple = 2.5) {
1185	        if (this._state !== 'CLOSED') { this.close(); setTimeout(() => this.simulateThermal(multiple), 400); return; }
1186	        this.loadCurrent = this.ratedCurrent * multiple;
1187	        // 热积累到阈值后自动触发
1188	    }
1189	
1190	    /** 模拟分励脱扣（远程控制信号）*/
1191	    simulateShunt() {
1192	        this._shuntSignal = true;
1193	        this._shuntPlunger = 0;
1194	        const doTrip = () => {
1195	            this._shuntPlunger = 1;
1196	            if (this._state !== 'CLOSED') { this.close(); setTimeout(doTrip, 400); return; }
1197	            this._triggerTrip('SHUNT');
1198	        };
1199	        doTrip();
1200	    }
1201	
1202	    /** 设置负载电流 */
1203	    setLoadCurrent(A) { this.loadCurrent = Math.max(0, A); }
```

#### consys.js — instantiates(instantiates), calls(calls), resetLinking(calls), getAbsPortPos(calls), showSystemContextMenu(calls), init(method), +45 more

```javascript
91	    /**
92	     * 系统初始化：创建组件并启动仿真循环
93	     */
94	    init() {
95	        const baseWidth = 1920;
96	        const baseHeight = 1080;
97	        const scaleX = window.innerWidth / baseWidth;
98	        const scaleY = window.innerHeight / baseHeight;
99	        const scale = Math.min(scaleX, scaleY);
100	        const offsetX = (window.innerWidth - baseWidth * scale) / 2;
101	        const offsetY = (window.innerHeight - baseHeight * scale) / 2;
102	
103	        const scaledConfigs = componentConfigs.map(cfg => ({
104	            ...cfg,
105	            x: cfg.x * scale + offsetX,
106	            y: cfg.y * scale + offsetY,
107	        }));
108	
109	        const visibilityMap = {}; // 存储需要隐藏的组件
110	
111	        scaledConfigs.forEach(cfg => {
112	            if (cfg.visible === false) {
113	                visibilityMap[cfg.id] = false;
114	                delete cfg.visible; // 移除 visible 参数，让组件正常初始化
115	            }
116	
117	            this.comps[cfg.id] = new cfg.Class(cfg, this);
118	            this.layer.add(this.comps[cfg.id].group);
119	        });
120	
121	        // 绘制一次以激活事件系统和完成初始化
122	        this._applyStaticCaching();
123	        this.layer.draw();
124	
125	        // 最后隐藏需要隐藏的组件
126	        Object.keys(visibilityMap).forEach(compId => {
127	            if (this.comps[compId] && this.comps[compId].group) {
128	                this.comps[compId].group.visible(false);
129	            }
130	        });
131	
132	        this.layer.draw();
133	
134	        this.workflowComp = new Workflow(this);
135	        this.voltageSolver = new CircuitSolver(this);
136	        this.pressSolver = new PneumaticSolver(this);
137	        this.digitalSolver = new DigitalSolver(this);
138	        this.mcuSolver = new MicrocontrollerSolver(this);
139	        this.mcs51Solver = new MCS51Solver(this);
140	        this.showComp = new Show(this);
141	
142	        // ── 事件总线与设备对象池 ──
143	        this.eventBus = new EventBus();
144	        this.equipmentPool = new EquipmentPool();
145	        this.thermalSolver = new ThermalSolver(this);
146	        // ── 硬件网关（可选，由 main.js 按需初始化 ──
147	        this.gatewayController = null;
148	
149	        // ── 集中化动画组件列表（替代各组件独立 rAF 循环） ──
150	        this._animCompIds = Object.keys(this.comps).filter(id => {
151	            const c = this.comps[id];
152	            return c && typeof c.tick === 'function';
153	        });
154	
155	        // ── LED 更新组件缓存（避免每帧遍历所有组件） ──
156	        this._ledCompIds = Object.keys(this.comps).filter(id => {
157	            const c = this.comps[id];
158	            return c && typeof c.updateLED === 'function';
159	        });
160	
161	        // ── 静态布尔缓存（组件类型构造后不变，避免每帧 Object.values().some()） ──
162	        this._hasDigital = Object.values(this.comps).some(c =>
163	            c.type && (c.type.startsWith('digital_') || c.type === 'mcu' || c.type === 'mcs51'));
164	        this._hasACSource = Object.values(this.comps).some(c =>
165	            c.type === 'ac_source' || c.type === 'source_3p' || c.type === 'signal_generator');
166	
167	        perfMonitor.enabled = true;
168	
169	        // ── 工具栏滑块（由项目配置实现）──
170	        initSlider(this);
171	
172	        this._scheduleNextPhysics();
173	    }
174	
175	    /**
176	     * 历史状态初始化：绑定撤销/重做按钮
177	     */
178	    initHistory() {
179	        const btnUndo = document.getElementById('btnUndo');
180	        const btnRedo = document.getElementById('btnRedo');
181	        this.history.onChange = () => {
182	            btnUndo.disabled = !(this.history.undos && this.history.undos.length > 0);
183	            btnRedo.disabled = !(this.history.redos && this.history.redos.length > 0);
184	        };
185	        this.history.onChange();
186	    }
187	
188	    /**
189	     * 连线交互初始化：鼠标移动虚线预览 + 右键取消
190	     */
191	    initStageEvents() {
192	        this.stage.on('mousemove', () => {
193	            if (!this.linkingState || !this.tempLine) return;
194	            const pos = this.stage.getPointerPosition();
195	            let startPos;
196	            if (this.linkingState.comp && this.linkingState.comp.getAbsPortPos) {
197	                startPos = this.linkingState.comp.getAbsPortPos(this.linkingState.portId);
198	            } else {
199	                const did = this.linkingState.portId.split('_wire_')[0] || this.linkingState.portId.split('_')[0];
200	                startPos = this.comps[did]?.getAbsPortPos(this.linkingState.portId);
201	            }
202	            if (!startPos) return;
203	            this.tempLine.points([startPos.x, startPos.y, pos.x, pos.y]);
204	            this.tempLine.moveToBottom();
205	            this.requestRedraw();
206	        });
207	
208	        this.stage.on('contextmenu', (e) => {
209	            e.evt.preventDefault();
210	            e.evt.stopPropagation();
211	            if (e.target === this.stage || e.target.name() === 'background-rect') {
212	                this.uiMgr.showSystemContextMenu(e.evt);
213	            }
214	        });
215	
216	        window.addEventListener('contextmenu', (e) => { e.preventDefault(); this.connMgr.resetLinking(); });
217	        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.connMgr.resetLinking(); });
218	    }
219	
220	    // ==========================================
221	    // 第二部分：代理方法（保持原有外部调用接口不变）
222	    // ==========================================
223	
224	    // ── 连线管理代理 ──────────────────────────────────────────
225	
226	    handlePortClick(comp, portId, type) {
227	        this.connMgr.handlePortClick(comp, portId, type);
228	    }
229	
230	    resetLinking() {
231	        this.connMgr.resetLinking();
232	    }
233	
234	    addConnWithHistory(conn) {
235	        this.connMgr.addConnWithHistory(conn);
236	    }
237	
238	    addConn(conn) {
239	        this.connMgr.addConn(conn);
240	    }
241	
242	    removeConnWithHistory(conn) {
243	        this.connMgr.removeConnWithHistory(conn);
244	    }
245	
246	    removeConn(conn) {
247	        this.connMgr.removeConn(conn);
248	    }
249	
250	    addConnectionAnimated(conn) {
251	        return this.connMgr.addConnectionAnimated(conn);
252	    }
253	
254	    _connEqual(a, b) {
255	        return this.connMgr.connEqual(a, b);
256	    }
257	
258	    _connKeyCanonical(c) {
259	        return this.connMgr.connKeyCanonical(c);
260	    }
261	
262	    // ── 渲染代理 ──────────────────────────────────────────────
263	
264	    redrawAll() {
265	        this.renderer.redrawAll();
266	    }
267	
268	    requestRedraw() {
269	        this._needsRedraw = true;
270	    }
271	
272	    updateLinePositions() {
273	        this.renderer.updateLinePositions();
274	    }
275	
276	    // ── UI 代理 ───────────────────────────────────────────────
277	
278	    showSystemContextMenu(evt) {
279	        this.uiMgr.showSystemContextMenu(evt);
280	    }
281	
282	    setSimulationStep(val) {
283	        this.uiMgr.setSimulationStep(val);
284	    }
285	
286	    showFloatingTip(text, duration) {
287	        this.uiMgr.showFloatingTip(text, duration);
288	    }
289	
290	    // ── 流程/故障代理 ─────────────────────────────────────────
291	
292	    switchWorkflow(taskValue) {
293	        this.workflowMgr.switchWorkflow(taskValue);
294	    }
295	
296	    openWorkflowPanel(mode) {
297	        this.workflowMgr.openWorkflowPanel(mode);
298	    }
299	
300	    applyAllPresets() {
301	        this.workflowMgr.applyAllPresets();
302	    }
303	
304	    async applyStartSystem() {
305	        return this.workflowMgr.applyStartSystem();
306	    }
307	
308	    fiveStep() {
309	        this.workflowMgr.fiveStep();
310	    }
311	
312	    // ==========================================
313	    // 第三部分：电路/气路仿真接口
314	    // ==========================================
315	
316	    getVoltageBetween(portIdA, portIdB) {
317	        return this.voltageSolver.getPD(portIdA, portIdB);
318	    }
319	
320	    isPortConnected(portIdA, portIdB) {
321	        return this.voltageSolver.isPortConnected(portIdA, portIdB);
322	    }
323	
324	    getPressAt(portId) {
325	        // 预留接口
326	    }
327	
328	    onComponentStateChange(dev) {
329	        // 预留接口
330	    }
331	
332	    // ==========================================
333	    // 第四部分：仿真主循环（物理计算 + 渲染）
```

#### components/BaseComponent.js — calls(calls), requestRedraw(calls), showContextMenu(calls), _forceCacheFlush(calls), handlePortClick(calls), rotate(calls), +26 more

```javascript
1	export class BaseComponent {
2	    constructor(config, sys) {
3	        if (!sys) console.error(`组件 ${config.id} 缺少 sys 引用!`);
4	        this.sys = sys;
5	        this.config = config;
6	        this.id = config.id;
7	        this.scale = config.scale || 1;
8	
9	        this.group = new Konva.Group({
10	            x: config.x,
11	            y: config.y,
12	            rotation: config.rotation || 0,
13	            draggable: true,
14	            id: config.id,
15	        });
16	
17	        this.ports = [];
18	
19	        const handlePointClick = (e) => {
20	            this.sys.lastClickedId = this.id;
21	        };
22	
23	        this.group.on('click tap', handlePointClick);
24	
25	        let pressTimer;
26	        this.group.on('touchstart', (e) => {
27	            pressTimer = window.setTimeout(() => {
28	                this.showContextMenu(e.evt);
29	            }, 600);
30	        });
31	        this.group.on('touchend touchmove', () => {
32	            clearTimeout(pressTimer);
33	        });
34	
35	        this.group.on('dragmove', () => {
36	            this.sys.redrawAll();
37	        });
38	
39	        this.group.on('contextmenu', (e) => {
40	            e.evt.preventDefault();
41	            e.cancelBubble = true;
42	            this.showContextMenu(e.evt);
43	        });
44	
45	        // 根据 config.scale 初始化缩放
46	        if (this.scale !== 1) {
47	            this.group.scale({ x: this.scale, y: this.scale });
48	        }
49	
50	        // ── 脏标记优化 ──
51	        // _cacheDirty: true 时 _refreshIfDirty() 才实际刷新 Konva cache
52	        // 避免 tick() 中每帧对稳态组件做无意义的 clearCache + cache()
53	        this._cacheDirty = true; // 首帧需要刷新
54	    }
55	
56	    /**
57	     * 标记下次 _refreshIfDirty() 需要实际刷新 Konva cache
58	     * 组件在 tick() 中视觉状态变化时调用此方法
59	     */
60	    markDirty() {
61	        this._cacheDirty = true;
62	    }
63	
64	    /**
65	     * tick() 末尾调用 — 仅当 markDirty() 被调用过才执行实际的 Konva cache 刷新
66	     * 替代在 tick() 中直接调用 _refreshCache()（后者总是刷新）
67	     */
68	    _refreshIfDirty() {
69	        if (!this._cacheDirty) return;
70	        this._cacheDirty = false;
71	        this._forceCacheFlush();
72	    }
73	
74	    /**
75	     * 总是执行 Konva cache 刷新
76	     * 供用户交互回调（点击、拖拽、配置变更）直接调用
77	     */
78	    _forceCacheFlush() {
79	        const target = this._staticGroup || this.group;
80	        if (!target) return;
81	        try {
82	            if (typeof target.clearCache === 'function') {
83	                target.clearCache();
84	                if (typeof target.cache === 'function') {
85	                    try {
86	                        const r = target.getClientRect({ relativeTo: target });
87	                        if (r && r.width > 0 && r.height > 0) {
88	                            target.cache();
89	                        }
90	                    } catch (e) {
91	                        try { target.cache(); } catch (err) { /* ignore */ }
92	                    }
93	                }
94	            }
95	        } catch (e) {
96	            console.warn('cache refresh failed', e);
97	        }
98	        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
99	    }
100	
101	    /**
102	     * 初始化三层次分组（KnifeSwitch 模式）
103	     *   _staticGroup   — 静态视觉元素（绘制一次，可缓存）
104	     *   _dynamicGroup  — 动态元素（每 tick 重建）
105	     *   _interactGroup — 交互层（点击/悬停，不缓存）
106	     */
107	    _initGroups() {
108	        if (this._staticGroup) return;
109	        this._staticGroup   = new Konva.Group({ name: '_staticGroup' });
110	        this._dynamicGroup  = new Konva.Group({ name: '_dynamicGroup' });
111	        this._interactGroup = new Konva.Group({ name: '_interactGroup' });
112	        this.group.add(this._staticGroup);
113	        this.group.add(this._dynamicGroup);
114	        this.group.add(this._interactGroup);
115	    }
116	
117	    addPort(x, y, id, type = 'wire', polarity = null, opacity = 1) {
118	        const composedId = `${this.id}_${type}_${id}`;
119	
120	        if (type === 'pipe') {
121	            const fillColor = (polarity === 'in') ? '#ff0000' : '#1395eb';
122	            const pg = new Konva.Group({ x, y, name: composedId, opacity: opacity });
123	
124	            const tube = new Konva.Rect({ x: -10, y: -6, width: 20, height: 12, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
125	            const seal = new Konva.Rect({ x: -8, y: -10, width: 16, height: 20, fill: '#7f8c8d', cornerRadius: 3 });
126	            const iface = new Konva.Rect({ x: -8, y: -8, width: 16, height: 16, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1 });
127	
128	            pg.add(tube, seal, iface);
129	
130	            pg.on('mouseenter', () => { pg.scale({ x: 1.06, y: 1.06 }); this.sys.stage.container().style.cursor = 'pointer'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
131	            pg.on('mouseleave', () => { pg.scale({ x: 1, y: 1 }); this.sys.stage.container().style.cursor = 'default'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
132	
133	            iface.hitStrokeWidth(15);
134	
135	            iface.on('mousedown touchstart', (e) => {
136	                e.cancelBubble = true;
137	                this.sys.handlePortClick(this, composedId, 'pipe');
138	            });
139	            iface.on('click', (e) => {
140	                e.cancelBubble = true;
141	            });
142	
143	            this.group.add(pg);
144	            this.ports.push({ id: composedId, origId: id, x, y, type: 'pipe', node: pg, parts: { tube, seal, iface } });
145	            return;
146	        }
147	
148	        const fillColor = (polarity === 'p') ? '#ff0000' : '#130901';
149	        const port = new Konva.Circle({ x, y, radius: 6, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1, name: composedId, hitStrokeWidth: 15 });
150	
151	        port.on('mouseenter', () => { port.radius(8); this.sys.stage.container().style.cursor = 'pointer'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
152	        port.on('mouseleave', () => { port.radius(6); this.sys.stage.container().style.cursor = 'default'; if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw(); });
153	
154	        port.on('mousedown touchstart', (e) => {
155	            e.cancelBubble = true;
156	            this.sys.handlePortClick(this, composedId, 'wire');
157	        });
158	        port.on('click', (e) => {
159	            e.cancelBubble = true;
160	        });
161	
162	        this.group.add(port);
163	        this.ports.push({ id: composedId, origId: id, x, y, type: 'wire', polarity, node: port });
164	    }
165	
166	    getAbsPortPos(portId) {
167	        const port = this.ports.find(p => p.id === portId);
168	        if (!port) return { x: 0, y: 0 };
169	
170	        if (port.node && typeof port.node.getAbsolutePosition === 'function') {
171	            const pos = port.node.getAbsolutePosition();
172	            return { x: pos.x, y: pos.y };
173	        }
174	
175	        try {
176	            const p = this.group.getAbsoluteTransform().point({ x: port.x || 0, y: port.y || 0 });
177	            return { x: p.x, y: p.y };
178	        } catch (e) {
179	            return { x: this.group.x() + (port.x || 0), y: this.group.y() + (port.y || 0) };
180	        }
181	    }
182	
183	    showConfigDialog() {
184	        const fields = this.getConfigFields();
185	
186	        const modal = document.createElement('div');
187	        modal.style = `
188	            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
189	            background: rgba(0,0,0,0.5); display: flex; align-items: center;
190	            justify-content: center; z-index: 9999; font-family: sans-serif;
191	        `;
192	
193	        const content = document.createElement('div');
194	        content.style = `
195	            background: white; padding: 20px; border-radius: 8px;
196	            width: 300px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
197	        `;
198	        content.innerHTML = `<h3 style="margin-top:0">配置设备: ${this.id}</h3>`;
199	
200	        const inputs = {};
201	        fields.forEach(f => {
202	            const row = document.createElement('div');
203	            row.style = 'margin-bottom: 15px;';
204	            const val = this.config[f.key] !== undefined ? this.config[f.key] : '';
205	
206	            let inputHtml = '';
207	            if (f.type === 'select') {
208	                const optionsHtml = f.options.map(opt => {
209	                    const isSelected = val == opt.value ? 'selected' : '';
210	                    return `<option value="${opt.value}" ${isSelected}>${opt.label}</option>`;
211	                }).join('');
212	                inputHtml = `
213	            <select id="diag_${f.key}"
214	                    style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px; background:white;">
215	                ${optionsHtml}
216	            </select>
217	        `;
218	            } else {
219	                inputHtml = `
220	            <input type="${f.type || 'text'}" id="diag_${f.key}"
221	                   value="${val}"
222	                   style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px;">
223	        `;
224	            }
225	
226	            row.innerHTML = `
227	        <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${f.label}</label>
228	        ${inputHtml}
229	    `;
230	            content.appendChild(row);
231	            inputs[f.key] = f;
232	        });
233	
234	        const btnRow = document.createElement('div');
235	        btnRow.style = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';
236	
237	        const cancelBtn = document.createElement('button');
238	        cancelBtn.innerText = '\u53D6\u6D88';
239	        cancelBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #eee; border-radius: 4px;';
240	
241	        const saveBtn = document.createElement('button');
242	        saveBtn.innerText = '\u4FDD\u5B58';
243	        saveBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #1395eb; color: white; border-radius: 4px;';
244	
245	        cancelBtn.onclick = () => this.sys.container.removeChild(modal);
246	
247	        saveBtn.onclick = () => {
248	            const newConfig = { ...this.config };
249	            fields.forEach(f => {
250	                const el = document.getElementById(`diag_${f.key}`);
251	                let val = el.value;
252	                if (f.type === 'number') val = parseFloat(val);
253	                newConfig[f.key] = val;
254	            });
255	            this.onConfigUpdate(newConfig);
256	            this.sys.container.removeChild(modal);
257	        };
258	
259	        btnRow.appendChild(cancelBtn);
260	        btnRow.appendChild(saveBtn);
261	        content.appendChild(btnRow);
262	        modal.appendChild(content);
263	        this.sys.container.appendChild(modal);
264	    }
265	
266	    getConfigFields() {
267	        return [
268	            { label: '\u5668\u4EF6\u540D\u79F0 (ID)', key: 'id', type: 'text' }
269	        ];
270	    }
271	
272	    onConfigUpdate(newConfig) {
273	        console.log('\u914D\u7F6E\u5DF2\u66F4\u65B0:', newConfig);
274	        this.id = newConfig.id;
275	    }
276	
277	    showContextMenu(evt) {
278	        const oldMenu = document.getElementById('comp-context-menu');
279	        if (oldMenu) oldMenu.remove();
280	
281	        const menu = document.createElement('div');
282	        menu.id = 'comp-context-menu';
283	        menu.style = `
284	        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
285	        background: white; border: 1px solid #ccc; border-radius: 4px;
286	        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
287	        padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;
288	    `;
289	
290	        const createItem = (label, onClick) => {
291	            const item = document.createElement('div');
292	            item.innerText = label;
293	            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
294	            item.onmouseenter = () => item.style.background = '#f0f0f0';
295	            item.onmouseleave = () => item.style.background = 'transparent';
296	            item.onclick = () => {
297	                onClick();
298	                menu.remove();
299	            };
300	            return item;
301	        };
302	
303	        menu.appendChild(createItem('\u5411\u53F3\u65CB\u8F6C 90\u00B0', () => this.rotate(90)));
304	        menu.appendChild(createItem('\u5411\u5DE6\u65CB\u8F6C 90\u00B0', () => this.rotate(-90)));
305	        menu.appendChild(createItem('\u53C2\u6570\u8BBE\u7F6E', () => this.showConfigDialog()));
306	
307	        this.sys.container.appendChild(menu);
308	
309	        const closeMenu = () => {
310	            menu.remove();
311	            window.removeEventListener('click', closeMenu);
312	        };
313	        window.addEventListener('click', closeMenu);
314	    }
315	
316	    rotate(deltaDeg) {
317	        const currentRot = this.group.rotation();
318	        this.group.rotation(currentRot + deltaDeg);
319	        this.config.rotation = this.group.rotation();
320	
321	        if (this.sys && typeof this.sys.updateLinePositions === 'function') this.sys.updateLinePositions();
322	        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();

... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)
