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
        const gwGroup = document.getElementById('gatewayGroup');
        if (gwGroup) gwGroup.style.display = 'none';
        else if (btnGateway) btnGateway.style.display = 'none';
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
// 本工程为船舶**机舱监视报警系统（Kongsberg K-Chief 600）**功能实验仿真，
// **多页工程**（PROJECT_PAGES：页 0 索引 / 页 1 报警系统主界面 / 页 2 延伸报警单元）：
//   页 1  kchief  操作站 Home 菜单：表格视图（当前报警 / 标签一览 / 被抑制标签…）、
//                 工艺流程图入口、Dock 报警组计数、ACK 确认 / 消音、测点报警参数设置；
//   页 2  extunit 六块值班面板（驾驶室 / 轮机长 / 大管轮 / 二管轮 / 三管轮 / 电机员）：
//                 On Watch 值班位置、Duty 值班交接、延伸报警就地确认、轮机员呼叫。
// 「自动接线」无外部接线（纯数据监视系统）；「起动系统」复位并投入运行；
// 「5 点步进」依次让各测点进入越限报警状态，便于逐点观察。
// 缺失的按钮统一判空跳过（不影响其余按钮绑定）。
const actionMap = {
    'btnUndo': () => sys.history.undo(),
    'btnRedo': () => sys.history.redo(),
    'btnAutoWire': () => { sys.applyAllPresets(); },
    'btnStartSys': () => { sys.applyStartSystem(); },
    'btnFiveStep': ()=> sys.fiveStep(),
    'btnReset': () => location.reload(),
    'btnInstrument':()=>sys.showInstrument(),
    // 多页导航（引用旧多页工程范式：主页图标 + ← → ，位于「选择仪表」之后）
    'btnHome': () => sys.goHome(),
    'btnBack': () => sys.goBack(),
    'btnForward': () => sys.goForward(),
};
// 统一遍历并绑定事件
Object.entries(actionMap).forEach(([id, action]) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = action;
});



// 2. 故障设置，统一 UI 交互逻辑
// 故障清单由 lib/WorkflowManager.initFault() 依项目 FAULT_CONFIGS 动态生成（本工程 5 项：
// 滑油进机压力低、缸套冷却水温度高、滑油低压开关动作、主滑油泵故障跳闸、舱底水高位）；
// 此处只负责弹窗开合、勾选状态同步与「应用设置」下发。
const faultUI = {
    modal: document.getElementById('faultModal'),
    form:  document.getElementById('faultForm'),

    // 打开/关闭 弹窗
    toggle: (visible) => {
        if (!faultUI.modal) return;
        if (visible) faultUI.sync();
        faultUI.modal.style.display = visible ? 'flex' : 'none';
    },

    // 同步系统状态到 UI
    sync: () => {
        if (!faultUI.form) return;
        faultUI.form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const cfg = sys.FAULT_CONFIG[cb.value];
            if (cfg) cb.checked = cfg.check( );
        });
    },

    // 应用 UI 勾选到系统
    apply: () => {
        if (!faultUI.form) return;
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

// 简洁的事件绑定（按钮/弹窗不存在时跳过）
const _faultBtn = document.getElementById('faultBtn');
if (_faultBtn) _faultBtn.onclick = () => faultUI.toggle(true);
const _faultCancelBtn = document.getElementById('cancelBtn');
if (_faultCancelBtn) _faultCancelBtn.onclick = () => faultUI.toggle(false);
const _faultApplyBtn = document.getElementById('applyBtn');
if (_faultApplyBtn) _faultApplyBtn.onclick = () => faultUI.apply();

// 仪表菜单关闭按钮
const _instrumentCancelBtn = document.getElementById('instrumentCancelBtn');
if (_instrumentCancelBtn) {
    _instrumentCancelBtn.onclick = () => {
        document.getElementById('instrumentModal').style.display = 'none';
    };
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
