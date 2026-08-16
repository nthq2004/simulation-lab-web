import Konva from 'konva'
import { ControlSystem } from './consys.js';

window.sys = new ControlSystem();

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