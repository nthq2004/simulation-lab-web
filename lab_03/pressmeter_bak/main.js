import Konva from 'konva'
import { ControlSystem } from './consys.js';

window.sys = new ControlSystem();

// ── 报警面板 / 回放面板的 DOM 引用 ──
const alarmPanel = document.getElementById('alarmPanel');
const alarmList = document.getElementById('alarmList');
const replayPanel = document.getElementById('replayPanel');
const replayProgress = document.getElementById('replayProgress');
const replayProgressText = document.getElementById('replayProgressText');
const replayPlayBtn = document.getElementById('replayPlayBtn');
const replayStatus = document.getElementById('replayStatus');
const replayFrameInfo = document.getElementById('replayFrameInfo');
const replaySpeed = document.getElementById('replaySpeed');
const replayRecordBtn = document.getElementById('replayRecordBtn');

let _isRecording = false;  // 录制状态标志

// ── 报警记录面板 ──
document.getElementById('btnAlarmLog').onclick = () => {
    const isVisible = alarmPanel.style.display === 'block';
    alarmPanel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) refreshAlarmList();
};

document.getElementById('alarmPanelClose').onclick = () => {
    alarmPanel.style.display = 'none';
};

document.getElementById('alarmAckAllBtn').onclick = async () => {
    const alarms = await window.sys.alarmLogger.getUnacknowledged();
    for (const a of alarms) {
        await window.sys.alarmLogger.acknowledge(a.id);
    }
    refreshAlarmList();
};

document.getElementById('alarmClearBtn').onclick = async () => {
    await window.sys.alarmLogger.clear();
    refreshAlarmList();
};

/** 刷新报警列表 UI */
async function refreshAlarmList() {
    try {
        const alarms = await window.sys.alarmLogger.getAll();
        if (alarms.length === 0) {
            alarmList.innerHTML = '<div class="alarm-empty">暂无报警记录</div>';
            return;
        }
        let html = '<table class="alarm-table"><thead><tr>' +
            '<th>时间</th><th>设备</th><th>消息</th><th>级别</th><th>操作</th>' +
            '</tr></thead><tbody>';
        alarms.forEach(a => {
            const dt = new Date(a.timestamp);
            const timeStr = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const sevClass = a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info';
            html += `<tr class="alarm-row${a.acknowledged ? ' acknowledged' : ''}">`;
            html += `<td>${timeStr}</td>`;
            html += `<td>${a.deviceId}</td>`;
            html += `<td>${a.message}</td>`;
            html += `<td><span class="alarm-severity ${sevClass}">${a.severity}</span></td>`;
            html += `<td>`;
            if (a.acknowledged) {
                html += `<button class="btn-ack" disabled>已确认</button>`;
            } else {
                html += `<button class="btn-ack" data-id="${a.id}">确认</button>`;
            }
            html += `</td></tr>`;
        });
        html += '</tbody></table>';
        alarmList.innerHTML = html;

        // 绑定确认按钮事件
        alarmList.querySelectorAll('.btn-ack[data-id]').forEach(btn => {
            btn.onclick = async () => {
                const id = parseInt(btn.dataset.id);
                await window.sys.alarmLogger.acknowledge(id);
                refreshAlarmList();
            };
        });
    } catch (err) {
        console.error('[AlarmUI] refresh error:', err);
    }
}

// ── 历史回放面板 ──
document.getElementById('btnReplay').onclick = () => {
    const isVisible = replayPanel.style.display === 'block';
    replayPanel.style.display = isVisible ? 'none' : 'block';
};

document.getElementById('replayPanelClose').onclick = () => {
    replayPanel.style.display = 'none';
};

/** 播放/暂停 */
replayPlayBtn.onclick = () => {
    const ctrl = window.sys.replayController;
    if (ctrl.isPlaying()) {
        ctrl.pause();
        replayPlayBtn.textContent = '\u25B6';
        replayPlayBtn.classList.remove('active');
        replayStatus.textContent = '已暂停';
    } else {
        ctrl.play();
        replayPlayBtn.textContent = '\u23F8';
        replayPlayBtn.classList.add('active');
        replayStatus.textContent = '回放中';
    }
};

/** 停止 */
document.getElementById('replayStopBtn').onclick = () => {
    const ctrl = window.sys.replayController;
    ctrl.pause();
    ctrl.seekToStart();
    replayPlayBtn.textContent = '\u25B6';
    replayPlayBtn.classList.remove('active');
    replayStatus.textContent = '已停止';
    updateReplayUI();
};

/** 进度条拖动 */
replayProgress.addEventListener('input', () => {
    const ctrl = window.sys.replayController;
    if (ctrl.getTotalCount() === 0) return;
    const pct = parseFloat(replayProgress.value) / 100;
    const idx = Math.floor(pct * (ctrl.getTotalCount() - 1));
    ctrl.pause();
    ctrl.seekByIndex(idx);
    replayPlayBtn.textContent = '\u25B6';
    replayPlayBtn.classList.remove('active');
    replayStatus.textContent = '已暂停';
    updateReplayUI();
});

/** 速度切换 */
replaySpeed.addEventListener('change', () => {
    const speed = parseFloat(replaySpeed.value);
    window.sys.replayController.setSpeed(speed);
});

/** 加载快照数据 */
document.getElementById('replayLoadBtn').onclick = async () => {
    try {
        const snapshots = await window.sys.historyRecorder.getAll();
        window.sys.replayController.load(snapshots);
        replayStatus.textContent = `已加载 ${snapshots.length} 帧`;
        updateReplayUI();
    } catch (err) {
        console.error('[ReplayUI] load error:', err);
        replayStatus.textContent = '加载失败';
    }
};

/** 录制开关 */
replayRecordBtn.onclick = () => {
    if (_isRecording) {
        window.sys.historyRecorder.stop();
        _isRecording = false;
        replayRecordBtn.textContent = '开始录制';
        replayRecordBtn.classList.remove('recording');
        replayStatus.textContent = '录制已停止';
    } else {
        window.sys.historyRecorder.start();
        _isRecording = true;
        replayRecordBtn.textContent = '停止录制';
        replayRecordBtn.classList.add('recording');
        replayStatus.textContent = '录制中...';
    }
};

/** 更新回放 UI 状态 */
function updateReplayUI() {
    const ctrl = window.sys.replayController;
    const total = ctrl.getTotalCount();
    const idx = ctrl.getCurrentIndex();
    const pct = total > 0 ? Math.round((idx / total) * 100) : 0;
    replayProgress.value = pct;
    replayProgressText.textContent = pct + '%';
    replayFrameInfo.textContent = `帧: ${idx} / ${total}`;
}

/** 监听回放事件自动更新 UI */
function listenReplayEvents() {
    const bus = window.sys.eventBus;
    if (!bus) return;
    bus.on('session:action', (payload) => {
        if (payload && payload.action && payload.action.startsWith('replay:')) {
            updateReplayUI();
            if (payload.action === 'replay:complete') {
                replayPlayBtn.textContent = '\u25B6';
                replayPlayBtn.classList.remove('active');
                replayStatus.textContent = '回放完成';
            }
        }
    });
}

// 初始化回放事件监听
listenReplayEvents();

// ── 学员报告面板 ──
const reportPanel = document.getElementById('reportPanel');
const reportPanelBody = document.getElementById('reportPanelBody');

document.getElementById('btnReport').onclick = () => {
    const isVisible = reportPanel.style.display === 'block';
    reportPanel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
        // 首次打开时初始化面板内容
        if (!reportPanel._uiInitialized) {
            reportPanelBody.innerHTML = window.sys.reportUI.getPanelHTML();
            window.sys.reportUI.bindEvents();
            reportPanel._uiInitialized = true;
        }
        // 刷新列表和状态
        window.sys.reportUI.refreshList();
        window.sys.reportUI._updateStatus();
    }
};

document.getElementById('reportPanelClose').onclick = () => {
    reportPanel.style.display = 'none';
};

// ── 硬件网关面板 ──
function initGatewayUI() {
    const panel = document.getElementById('gatewayPanel');
    const panelBody = document.getElementById('gatewayPanelBody');
    const btnGateway = document.getElementById('btnGateway');

    if (!panel || !panelBody || !btnGateway) return;

    // 首次打开时初始化面板内容
    let initialized = false;

    btnGateway.onclick = () => {
        const isVisible = panel.style.display === 'block';
        panel.style.display = isVisible ? 'none' : 'block';

        if (!isVisible && !initialized) {
            // 填充面板内容
            panelBody.innerHTML = window.sys.gatewayPanelHtml;
            // 绑定事件
            const { GatewayPanel } = window.sys.gatewayPanelModule;
            GatewayPanel.bindEvents(window.sys.gatewayController);
            initialized = true;
        }
    };

    document.getElementById('gatewayPanelClose').onclick = () => {
        panel.style.display = 'none';
    };
}

// 延迟初始化网关 UI（等待 sys 就绪）
window.addEventListener('DOMContentLoaded', () => {
    // 动态导入 GatewayPanel 获取面板 HTML
    import('./gateway/GatewayUI.js').then(mod => {
        window.sys.gatewayPanelModule = mod;
        window.sys.gatewayPanelHtml = mod.GatewayPanel.createPanel();
        initGatewayUI();
    }).catch(err => {
        console.warn('[GatewayUI] 无法加载网关模块:', err);
    });
});

// 1. 定义按钮 ID 与对应操作的映射表，一般为5个或6个按钮。
const actionMap = {
    'btnUndo': () => sys.history.undo(),
    'btnRedo': () => sys.history.redo(),
    'btnAutoWire': () => sys.applyAllPresets(),
    'btnStartSys': () => sys.applyStartSystem(),
    'btnFiveStep': ()=> sys.fiveStep(),
    'btnReset': () => location.reload(),
    'btnInstrument':()=>sys.showInstrument(),

};
// 统一遍历并绑定事件
Object.entries(actionMap).forEach(([id, action]) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = action;
});



// 2. 故障设置，统一 UI 交互逻辑，一个按钮。
const faultUI = {
    modal: document.getElementById('faultModal'),
    form:  document.getElementById('faultForm'),
    
    // 打开/关闭 弹窗
    toggle: (visible) => {
        if (visible) faultUI.sync();
        faultUI.modal.style.display = visible ? 'flex' : 'none';
    },

    // 同步系统状态到 UI
    sync: () => {
        faultUI.form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const cfg = sys.FAULT_CONFIG[cb.value];
            if (cfg) cb.checked = cfg.check( );
        });
    },

    // 应用 UI 勾选到系统
    apply: () => {
        faultUI.form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const code = cb.value;
            const cfg = sys.FAULT_CONFIG[code];
            if (!cfg) return;

            cb.checked ? cfg.trigger() : cfg.repair( );
        });
        faultUI.toggle(false);
        if (sys && typeof sys.requestRedraw === 'function') sys.requestRedraw();
    }
};

// 简洁的事件绑定
document.getElementById('faultBtn').onclick  = () => faultUI.toggle(true);
document.getElementById('cancelBtn').onclick = () => faultUI.toggle(false);
document.getElementById('applyBtn').onclick  = () => faultUI.apply();

// 仪表菜单关闭按钮
document.getElementById('instrumentCancelBtn').onclick = () => {
    document.getElementById('instrumentModal').style.display = 'none';
};


// 3. 后面4个按钮的显示和操作逻辑
window.addEventListener('DOMContentLoaded', (event) => {
    // 调用你的初始化逻辑
    initControlLogic();
    initScenarioUI();
});
//（1）选择框，不管是自动演示、单步演示、演练、评估，先在这里选择项目
function initControlLogic() {
    const taskSelect = document.getElementById('taskSelect');
    const buttons = [
        document.getElementById('btnShow'),
        document.getElementById('btnStep'),
        document.getElementById('btnTrain'),
        document.getElementById('btnEval')
    ];
    // 定义一个内部函数，用于根据下拉框的值刷新按钮状态
    const refreshUI = () => {
        const isSelected = taskSelect.value !== "";

        buttons.forEach(btn => {
            if (btn) {
                btn.disabled = !isSelected;
                // 视觉反馈
                btn.style.cursor = isSelected ? 'pointer' : 'not-allowed';
                btn.style.opacity = isSelected ? '1' : '0.5';
            }
        });
    };
    // 文档加载/初始化时立即执行一次逻辑
    // 如果是封装在类中，这里直接执行一次即可
    refreshUI();
    // 监听后续的手动变化
    taskSelect.addEventListener('change', () => {
        refreshUI();
        sys.switchWorkflow(taskSelect.value);
    });
}

/** 显示 3D 设备参数浮窗 */
function show3DDevicePanel(devId) {
    const panel = document.getElementById('deviceInfoPanel')
        || createDeviceInfoPanel();
    const eq = window.sys.equipmentPool ? window.sys.equipmentPool.get(devId) : null;
    if (!eq) {
        panel.style.display = 'none';
        return;
    }
    let html = `<div style="font-weight:bold;margin-bottom:8px;font-size:14px;">${eq.label || devId}</div>`;
    html += `<div style="font-size:12px;color:#aaa;margin-bottom:6px;">类型: ${eq.type}</div>`;
    if (eq.state) {
        html += `<div style="font-size:12px;border-top:1px solid #444;padding-top:6px;">`;
        Object.entries(eq.state).forEach(([key, val]) => {
            if (key === 'alarms') {
                if (Array.isArray(val) && val.length > 0) {
                    html += `<div style="color:#ff6b6b;">报警: ${val.join(', ')}</div>`;
                }
            } else {
                html += `<div>${key}: ${typeof val === 'number' ? val.toFixed(1) : val}</div>`;
            }
        });
        html += `</div>`;
    }
    panel.innerHTML = html;
    panel.style.display = 'block';
}

function createDeviceInfoPanel() {
    const panel = document.createElement('div');
    panel.id = 'deviceInfoPanel';
    Object.assign(panel.style, {
        position: 'absolute', bottom: '20px', left: '20px',
        background: 'rgba(0,0,0,0.75)', color: '#fff',
        padding: '12px 16px', borderRadius: '8px',
        fontFamily: 'Arial, sans-serif', fontSize: '13px',
        minWidth: '200px', maxWidth: '300px', zIndex: '1000',
        display: 'none', borderLeft: '4px solid #4fc3f7',
    });
    document.body.appendChild(panel);
    return panel;
}

// （2）定义映射配置：ID -> 模式
const workflowMap = {
    'btnShow': 'show',
    'btnStep': 'step',
    'btnTrain': 'train',
    'btnEval': 'eval'
};
// 统一遍历绑定
Object.entries(workflowMap).forEach(([id, mode]) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.onclick = () => sys.openWorkflowPanel(mode);
    }
});

// 4. 监听窗口大小变化，调整舞台尺寸
window.addEventListener('resize', () => {
    sys.stage.width(sys.container.offsetWidth);
    sys.stage.height(sys.container.offsetHeight);
    sys.redrawAll();
    if (sys.engineRoom3D) sys.engineRoom3D.resize();
});

// 5. 2D/3D 视图切换
document.getElementById('btnViewToggle').onclick = () => {
    const container2d = document.getElementById('container');
    const container3d = document.getElementById('container3d');
    const btn = document.getElementById('btnViewToggle');
    const is3D = container3d.style.display === 'block';

    if (is3D) {
        // 切换回 2D
        container3d.style.display = 'none';
        container2d.style.display = 'block';
        btn.textContent = '3D 视图';
        btn.classList.remove('active');
        if (sys.engineRoom3D) {
            if (sys.engineRoom3D._on3DKeyDown) {
                document.removeEventListener('keydown', sys.engineRoom3D._on3DKeyDown);
            }
            sys.engineRoom3D.dispose();
            sys.engineRoom3D = null;
        }
        // 恢复 2D 舞台尺寸
        sys.stage.width(container2d.offsetWidth);
        sys.stage.height(container2d.offsetHeight);
        sys.redrawAll();
    } else {
        // 切换到 3D
        container2d.style.display = 'none';
        container3d.style.display = 'block';
        btn.textContent = '2D 视图';
        btn.classList.add('active');
        // 动态加载 Three.js 和 3D 模块
        Promise.all([
            import('three'),
            import('./engineroom3d/EngineRoom3D.js'),
            import('./engineroom3d/layout/DeckManager.js'),
            import('./engineroom3d/layout/LayoutData.js'),
            import('./engineroom3d/visualization/FlowParticles.js'),
            import('./engineroom3d/models/primitives/Pipe3D.js'),
            import('./engineroom3d/integration/EventBridge.js'),
            import('./engineroom3d/controls/WalkControl.js'),
        ]).then(([
            THREE,
            { EngineRoom3D },
            { DeckManager },
            { COOLING_LAYOUT, PHASE2_LAYOUT },
            { FlowParticles },
            { createPipeSegment },
            { EventBridge },
            { WalkControl }
        ]) => {
            const er3d = new EngineRoom3D(container3d);
            sys.engineRoom3D = er3d;

            // 注入设备对象池（数字孪生状态数据源）
            er3d.setEquipmentPool(sys.equipmentPool);

            // 构建场景
            const deck = new DeckManager(er3d.scene);

            // 创建甲板
            COOLING_LAYOUT.decks.forEach(d => deck.addDeck(d.y, d.width, d.depth, d));

            // 创建设备
            COOLING_LAYOUT.devices.forEach(dev => {
                er3d.addDevice(dev.id, dev.type, dev.position, { scale: dev.scale });
            });

            // 创建管路
            COOLING_LAYOUT.pipes.forEach(p => {
                const from = new THREE.Vector3(p.from[0], p.from[1], p.from[2]);
                const to = new THREE.Vector3(p.to[0], p.to[1], p.to[2]);
                const pipe = createPipeSegment({ from, to, color: p.color });
                er3d.scene.add(pipe);
            });

            // 创建 Phase 2 设备
            PHASE2_LAYOUT.devices.forEach(dev => {
                er3d.addDevice(dev.id, dev.type, dev.position, {
                    scale: dev.scale,
                    label: dev.label || dev.id
                });
            });

            // 创建 Phase 2 管路
            PHASE2_LAYOUT.pipes.forEach(p => {
                const from = new THREE.Vector3(p.from[0], p.from[1], p.from[2]);
                const to = new THREE.Vector3(p.to[0], p.to[1], p.to[2]);
                const pipe = createPipeSegment({ from, to, color: p.color });
                er3d.scene.add(pipe);
            });

            // 创建管路流体粒子动画
            const flowParts = new FlowParticles(er3d.scene, sys.equipmentPool);
            COOLING_LAYOUT.pipes.forEach(p => flowParts.registerPipe(p));
            PHASE2_LAYOUT.pipes.forEach(p => flowParts.registerPipe(p));
            er3d.setFlowParticles(flowParts);

            // 连接事件总线
            const bridge = new EventBridge(sys.eventBus, er3d);
            bridge.connect();

            // 初始化 WalkControl
            const walkCtrl = new WalkControl(er3d.camera, container3d, {
                speed: 3,
                bounds: { xMin: -8, xMax: 8, zMin: -6, zMax: 6 }
            });
            er3d.setWalkControl(walkCtrl);

            // 设备点击交互
            er3d.initClickDetection((devId) => {
                if (sys.eventBus) {
                    sys.eventBus.emit('equipment:select', { id: devId });
                }
                er3d.focusOn(devId);
                show3DDevicePanel(devId);
            });

            // 键盘快捷键：W 漫游, O 鸟瞰, Esc 回到鸟瞰
            const on3DKeyDown = (e) => {
                if (!sys.engineRoom3D) return;
                if (e.key === 'w' || e.key === 'W') {
                    er3d.switchViewMode('walk');
                    e.preventDefault();
                } else if (e.key === 'o' || e.key === 'O') {
                    er3d.switchViewMode('orbit');
                    e.preventDefault();
                } else if (e.key === 'Escape' && er3d.cameraManager.mode === 'walk') {
                    er3d.switchViewMode('orbit');
                }
            };
            document.addEventListener('keydown', on3DKeyDown);
            // 存储引用以便清理
            er3d._on3DKeyDown = on3DKeyDown;
        }).catch(err => {
            console.error('Failed to load 3D engine:', err);
            btn.textContent = '3D 视图';
            btn.classList.remove('active');
            container3d.style.display = 'none';
            container2d.style.display = 'block';
        });
    }
};

// 6. 工况场景 UI 初始化
function initScenarioUI() {
    const select = document.getElementById('scenarioSelect');
    const btnApply = document.getElementById('btnApplyScenario');
    if (!select || !btnApply) return;

    // 填充下拉框
    const scenarios = window.sys.scenarioManager.getAll();
    scenarios.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
    });

    // 绑定应用按钮
    btnApply.onclick = () => {
        const id = select.value;
        if (!id) {
            alert('请先选择一个场景');
            return;
        }
        window.sys.scenarioManager.apply(id);
    };
}