import Konva from 'konva'
import { ControlSystem } from './consys.js';

// 初始化时可传入 { gateway: true } 开启硬件网关功能
window.sys = new ControlSystem({ gateway: false });

// ── 硬件网关面板（可选功能）──
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

function initGateway() {
    const btnGateway = document.getElementById('btnGateway');
    const panel = document.getElementById('gatewayPanel');

    if (!window.sys._options.gateway) {
        // 网关功能未启用，隐藏按钮和面板
        if (btnGateway) btnGateway.style.display = 'none';
        if (panel) panel.style.display = 'none';
        return;
    }

    // 动态导入网关模块（仅在开启时加载）
    import('./gateway/GatewayUI.js').then(mod => {
        window.sys.gatewayPanelModule = mod;
        window.sys.gatewayPanelHtml = mod.GatewayPanel.createPanel();
        // 创建网关控制器（需要 equipmentPool 和 eventBus，已在 consys 中初始化）
        window.sys.gatewayController = new mod.GatewayController(
            window.sys.equipmentPool,
            window.sys.eventBus,
            { baudRate: 115200, wsUrl: 'ws://localhost:8080' }
        );
        initGatewayUI();
    }).catch(err => {
        console.warn('[GatewayUI] 无法加载网关模块:', err);
    });
}

// 1. 定义按钮 ID 与对应操作的映射表
// 重载询问面板勾选状态下的接线恢复：接线/起动系统会清空连线，
// 若勾选框已勾选（面板显示），需自动补回重载询问的 6 条接线。
const syncHeavyLoadWires = () => {
    if (!sys || !sys.connMgr || !sys.comps) return;
    const cb = document.getElementById('heavyLoadShow');
    if (!cb || !cb.checked) return;
    HEAVYLOAD_WIRES.forEach(c => sys.connMgr.addConn(c));
};
const actionMap = {
    'btnUndo': () => sys.history.undo(),
    'btnRedo': () => sys.history.redo(),
    'btnAutoWire': () => { sys.applyAllPresets(); syncHeavyLoadWires(); },
    'btnStartSys': () => { sys.applyStartSystem(); syncHeavyLoadWires(); },
    'btnFiveStep': ()=> sys.fiveStep(),
    'btnReset': () => location.reload(),
    'btnInstrument':()=>sys.showInstrument(),

};
// 统一遍历并绑定事件
Object.entries(actionMap).forEach(([id, action]) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = action;
});



// 2. 故障设置，统一 UI 交互逻辑
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

// 重载询问面板显隐勾选框（放在「选择仪表」之后，勾选显示 / 取消隐藏 heavyload 组件）
// 勾选显示时自动连接重载询问相关接线（三相电源 + 中性点 + 通信 heavy_a/heavy_b），
// 取消勾选隐藏时删除这些接线（重载询问只有通信端口连接了才能收到回应）。
const HEAVYLOAD_WIRES = [
    { from: 'bus1_wire_l1_5', to: 'heavyload_wire_l1', type: 'wire' },
    { from: 'bus1_wire_l2_5', to: 'heavyload_wire_l2', type: 'wire' },
    { from: 'bus1_wire_l3_5', to: 'heavyload_wire_l3', type: 'wire' },
    { from: 'heavyload_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    { from: 'auto_ctl_wire_heavy_a', to: 'heavyload_wire_heavy_a', type: 'wire' },
    { from: 'auto_ctl_wire_heavy_b', to: 'heavyload_wire_heavy_b', type: 'wire' },
];
const heavyLoadShow = document.getElementById('heavyLoadShow');
if (heavyLoadShow) {
    heavyLoadShow.addEventListener('change', () => {
        const visible = heavyLoadShow.checked;
        sys.toggleInstrumentVisibility('heavyload', visible);
        if (!sys || !sys.connMgr) return;
        if (visible) {
            HEAVYLOAD_WIRES.forEach(c => sys.connMgr.addConn(c));
        } else {
            // 隐藏时若负载仍在运行，先卸载，避免断线后残留注入
            const hv = sys.comps && sys.comps.heavyload;
            if (hv && typeof hv._stopLoad === 'function') hv._stopLoad();
            HEAVYLOAD_WIRES.forEach(c => sys.connMgr.removeConn(c));
        }
    });
}


// 3. 后面4个按钮的显示和操作逻辑
window.addEventListener('DOMContentLoaded', (event) => {
    // 调用你的初始化逻辑
    initControlLogic();
    initGateway();
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
    refreshUI();
    // 监听后续的手动变化
    taskSelect.addEventListener('change', () => {
        refreshUI();
        sys.switchWorkflow(taskSelect.value);
    });
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
});

// 本行已删除（chkShowTZN 温控测试）
