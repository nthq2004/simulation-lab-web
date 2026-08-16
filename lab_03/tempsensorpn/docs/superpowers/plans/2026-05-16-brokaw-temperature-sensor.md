# Brokaw 半导体温度传感器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development or executing-plans to implement this plan task-by-task.

**Goal:** 构建可搭建的 Brokaw 半导体温度传感器仿真电路（NPN 温度传感三极管 ×2 + 运放 + 输出三极管），通过自动接线一键搭建，温度滑块/5点步进控制温度，万用表测量输出。

**Architecture:**
- 新建 `NpnTempSensor` 组件（继承 BaseComponent），集成温度相关 Vbe 模型（-2mV/°C + areaRatio × Vt×ln(N) 修正）
- 全局温度 `sys.globalTemp` + 工具栏温度滑块
- 两套项目共存于画布，通过 hide/show 切换（PTC 项目 ↔ Brokaw 项目）
- 自动接线预设 + 7 步教学流程 + 5 点步进（温度循环）

**Tech Stack:** Konva.js, MNA 电路求解器, Vite

---

### Task 1: 创建 NpnTempSensor 组件

**Files:**
- Create: `components/NpnTempSensor.js`

- [ ] **Step 1: 创建 NpnTempSensor.js**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * NpnTempSensor - 温度传感 NPN 三极管
 * 
 * Vbe 模型：
 *   Vt = kT/q = 8.617e-5 * (273 + T)
 *   Vbe_on(T, areaRatio) = vbe0 + (T - 25) * TC - Vt * ln(areaRatio)
 *   其中 areaRatio > 1 时 Vbe 降低 Vt*ln(N)
 * 
 * 端口: b(基极), c(集电极), e(发射极) ── 与现有 Transistor.js 兼容
 */
export class NpnTempSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'bjt';
        this.subType = 'NPN';
        this.cache = 'fixed';

        // 温度传感参数
        this.areaRatio = config.areaRatio || 1;     // 发射极面积比 {1, 8}
        this.vbe0 = config.vbe0 || 0.65;             // 25°C 时 areaRatio=1 的 Vbe
        this.vbeTC = -0.002;                          // Vbe 温度系数 -2mV/°C
        this.beta = config.beta || 200;
        this.vceSat = 0.2;

        this.config = {
            id: this.id,
            areaRatio: this.areaRatio,
            vbe0: this.vbe0,
            beta: this.beta
        };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        const s = this.scale;
        this.addPort(-40 * s, 0, 'b', 'wire', 'b');
        this.addPort(20 * s, -40 * s, 'c', 'wire', 'c');
        this.addPort(20 * s, 40 * s, 'e', 'wire', 'e');
    }

    initVisuals() {
        this.group.destroyChildren();
        const s = this.scale;
        const stroke = '#000000';
        const sw = 2 * s;

        // 圆圈
        this.group.add(new Konva.Circle({
            x: 0, y: 0, radius: 30 * s,
            stroke, strokeWidth: sw, fill: '#ffffff'
        }));

        // 基极竖线
        this.group.add(new Konva.Line({
            points: [-10 * s, -15 * s, -10 * s, 15 * s],
            stroke, strokeWidth: 3 * s
        }));

        // 引线
        this.group.add(new Konva.Line({ points: [-40 * s, 0, -10 * s, 0], stroke, strokeWidth: sw }));
        this.group.add(new Konva.Line({ points: [-10 * s, -8 * s, 20 * s, -25 * s, 20 * s, -40 * s], stroke, strokeWidth: sw }));
        this.group.add(new Konva.Line({ points: [-10 * s, 8 * s, 20 * s, 25 * s, 20 * s, 40 * s], stroke, strokeWidth: sw }));

        // NPN 箭头
        this.group.add(new Konva.Arrow({
            points: [2 * s, 16 * s, 15 * s, 23 * s],
            pointerLength: 8 * s, pointerWidth: 6 * s,
            fill: stroke, stroke: stroke, strokeWidth: 1 * s
        }));

        // 面积比标签
        this.areaLabel = new Konva.Text({
            x: 25 * s, y: -10 * s,
            text: `×${this.areaRatio}`,
            fontSize: 11 * s, fill: '#e74c3c', fontStyle: 'bold'
        });
        this.group.add(this.areaLabel);
    }

    /**
     * 温度相关的 Vbe 计算
     */
    getVbeOn() {
        if (!this.sys || this.sys.globalTemp === undefined) {
            return this.vbe0; // 默认 25°C
        }
        const T = this.sys.globalTemp;
        const Vt = 8.617e-5 * (273 + T); // kT/q
        // areaRatio > 1 时 Vbe 降低 Vt*ln(N)
        const areaCorrection = Vt * Math.log(this.areaRatio);
        return this.vbe0 + (T - 25) * this.vbeTC - areaCorrection;
    }

    /**
     * MNA 伴随模型 ── 与现有 Transistor 格式兼容
     */
    getCompanionModel(vB, vC, vE) {
        const isNPN = true;
        const pol = 1;
        const beta = this.beta || 200;

        const vbe = (vB - vE) * pol;
        const vce = (vC - vE) * pol;

        // Vbe 导通阈值（温度相关）
        const V_ON = this.getVbeOn();
        const G_ON = 2;
        const gBE = (vbe > V_ON && vbe > 0) ? G_ON : 1e-9;
        const iBE = (vbe > V_ON && vbe > 0) ? -V_ON * G_ON : 0;

        // 软饱和
        const saturationMultiplier = Math.tanh(Math.max(0, vce) / 0.2);
        const currentBeta = beta * saturationMultiplier;

        let gCE_sat = 0;
        if (vbe > V_ON) {
            gCE_sat = G_ON * (1 - saturationMultiplier);
        }
        if (vce < 0) gCE_sat += 100;

        return {
            internal: { gBE, iBE, beta: currentBeta, gCE_sat, pol, V_SAT: 0.2 }
        };
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '面积比', key: 'areaRatio', type: 'select', options: [
                { label: '1 (Q1)', value: 1 },
                { label: '8 (Q2)', value: 8 }
            ]},
            { label: 'Vbe0 @25°C (V)', key: 'vbe0', type: 'number' },
            { label: '放大倍数 Beta', key: 'beta', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.config = newConfig;
        this.id = newConfig.id;
        this.areaRatio = parseInt(newConfig.areaRatio) || 1;
        this.vbe0 = parseFloat(newConfig.vbe0) || 0.65;
        this.beta = parseInt(newConfig.beta) || 200;
        this.initVisuals();
        this.initPorts();
        this._refreshCache();
    }
}
```

### Task 2: 修改 export.js

**Files:**
- Modify: `export.js`

- [ ] **Step 1: 添加导入导出**

在第 55-56 行附近（Diode 导入后面），添加 NpnTempSensor：

```javascript
import { NpnTempSensor } from './components/NpnTempSensor.js';
```

在导出列表（最后部分）中添加：

```javascript
export { NpnTempSensor, ...existing_exports };
```

实际修改：找到 export 语句，把 NpnTempSensor 加进去。

在 `export {` 块中找到 Diode 那一行，在其后面添加：

```javascript
    NpnTempSensor,
```

### Task 3: 修改 consys.js ── 全局温度 + Brokaw 组件初始化 + 项目切换

**Files:**
- Modify: `consys.js`

- [ ] **Step 1: 在类顶部添加全局温度属性和温度滑块方法**

在 `init()` 方法之前（或 constructor 区域），添加全局温度初始化。需要在 `constructor()` 中添加 `this.globalTemp = 25;`。

找到 constructor 中初始化属性的区域（~第 19-64 行），在 `this._physicsIterCount = 0;` 后添加：

```javascript
// ── 全局温度 ──
this.globalTemp = 25;
this._currentProject = 0;  // 0=PTC, 1=Brokaw
```

- [ ] **Step 2: 添加温度滑块 UI**

在 init() 方法末尾（this._renderLoop() 调用之前），添加动态创建温度滑块的代码：

```javascript
// ── 工具栏温度滑块 ──
this._initTempSlider();
```

在 `init()` 之后添加新方法 `_initTempSlider()`：

```javascript
_initTempSlider() {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'tempSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">温度:</span>
        <input type="range" id="tempSlider" min="-40" max="150" value="25" style="width:120px;">
        <span id="tempDisplay" style="font-size:12px;min-width:50px;">25°C</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('tempSlider');
    const display = document.getElementById('tempDisplay');
    slider.addEventListener('input', () => {
        this.globalTemp = parseFloat(slider.value);
        display.textContent = this.globalTemp.toFixed(0) + '°C';
        this.requestRedraw();
    });
}
```

- [ ] **Step 3: 向 componentConfigs 中添加 Brokaw 组件**

在 `init()` 方法的 `componentConfigs` 数组中，PTC 组件列表之后，添加 Brokaw 项目组件（所有 `visible: false`）：

```javascript
// ── Brokaw 温度传感器 ──
{ Class: NpnTempSensor, id: 'b_q1', x: 400, y: 400, areaRatio: 1, visible: false },
{ Class: NpnTempSensor, id: 'b_q2', x: 550, y: 400, areaRatio: 8, visible: false },
{ Class: Resistor, id: 'b_r1', x: 580, y: 520, value: 360, direction: 'vertical', visible: false },
{ Class: Resistor, id: 'b_r2', x: 350, y: 240, value: 10000, direction: 'vertical', visible: false },
{ Class: Resistor, id: 'b_r3', x: 600, y: 240, value: 10000, direction: 'vertical', visible: false },
{ Class: OpAmp, id: 'b_u1', x: 850, y: 320, source: 15, visible: false },
{ Class: NpnTempSensor, id: 'b_q3', x: 1100, y: 400, areaRatio: 1, visible: false },
{ Class: Resistor, id: 'b_r4', x: 1140, y: 520, value: 1000, direction: 'vertical', visible: false },
{ Class: Ground, id: 'b_gnd1', x: 400, y: 600, visible: false },
{ Class: Ground, id: 'b_gnd2', x: 600, y: 600, visible: false },
{ Class: Ground, id: 'b_gnd3', x: 1140, y: 600, visible: false },
{ Class: DCPower, id: 'b_vcc', x: 200, y: 130, voltage: 15, visible: false },
{ Class: Ground, id: 'b_gnd4', x: 200, y: 600, visible: false },
{ Class: TempMeter, id: 'b_meter', x: 1350, y: 200, title: 'Vout', visible: false },
```

同时添加 NpnTempSensor 的导入到文件头部（其他 import 附近）：

```javascript
import { NpnTempSensor } from './components/NpnTempSensor.js';
```

- [ ] **Step 4: 项目切换逻辑修改**

在 `init()` 方法末尾，添加对 taskSelect 切换事件的监听：

找到 `this.workflowMgr.initSteps();` 这一行之后，添加：

```javascript
// ── 项目切换监听 ──
const taskSelect = document.getElementById('taskSelect');
taskSelect.addEventListener('change', () => {
    const val = taskSelect.value;
    if (val === '0' || val === '') {
        this._switchProject(0);
    } else if (val === '1') {
        this._switchProject(1);
    }
});
```

添加 `_switchProject` 方法：

```javascript
_switchProject(projectId) {
    this._currentProject = projectId;

    // 定义每个项目的组件 ID 列表
    const projectComps = [
        // 项目 0: PTC
        ['dcpower', 'gnd2', 'ptc', 'load', 'gnd', 'osc3', 'sg', 'multimeter', 'ampmeter', 'cali'],
        // 项目 1: Brokaw
        ['b_vcc', 'b_q1', 'b_q2', 'b_r1', 'b_r2', 'b_r3', 'b_u1', 'b_q3', 'b_r4',
         'b_gnd1', 'b_gnd2', 'b_gnd3', 'b_gnd4', 'b_meter']
    ];

    // 先隐藏所有组件
    Object.values(this.comps).forEach(c => {
        if (c.group) c.group.hide();
    });

    // 显示当前项目组件
    const activeIds = projectComps[projectId] || [];
    activeIds.forEach(id => {
        if (this.comps[id] && this.comps[id].group) {
            this.comps[id].group.show();
        }
    });

    // 清空连线
    this.conns = [];
    this.redrawAll();
    this.requestRedraw();

    // 重置温度滑块显示
    if (projectId === 1) {
        this.globalTemp = 25;
        const slider = document.getElementById('tempSlider');
        const display = document.getElementById('tempDisplay');
        if (slider) { slider.value = 25; }
        if (display) { display.textContent = '25°C'; }
    }
}
```

### Task 4: 修改 WorkflowManager ── Brokaw 项目配置 + 自动接线 + 7步流程 + 5点步进

**Files:**
- Modify: `lib/WorkflowManager.js`

- [ ] **Step 1: 在 projectConfigs 中添加 Brokaw 项目**

找到 `projectConfigs` 数组，添加第二个项目：

```javascript
const projectConfigs = [
    { id: 0, name: "1. PTC电阻实现的过热保护电路" },
    { id: 1, name: "2. Brokaw温度传感器仿真电路" },
];
```

- [ ] **Step 2: 定义 Brokaw 自动接线预设**

在 `initSteps()` 方法中，`sys.stepsArray[0]` 定义之后，为项目 1 添加 `sys.stepsArray[1]`：

```javascript
// ── Brokaw 温度传感器 自动接线 ──
const brokawConns = [
    { from: 'b_vcc_wire_p', to: 'b_r2_wire_l', type: 'wire' },
    { from: 'b_vcc_wire_p', to: 'b_r3_wire_l', type: 'wire' },
    { from: 'b_r2_wire_r', to: 'b_q1_wire_c', type: 'wire' },
    { from: 'b_r3_wire_r', to: 'b_q2_wire_c', type: 'wire' },
    { from: 'b_q1_wire_e', to: 'b_gnd1_wire_gnd', type: 'wire' },
    { from: 'b_q2_wire_e', to: 'b_r1_wire_l', type: 'wire' },
    { from: 'b_r1_wire_r', to: 'b_gnd2_wire_gnd', type: 'wire' },
    { from: 'b_q1_wire_c', to: 'b_u1_wire_n', type: 'wire' },
    { from: 'b_q2_wire_c', to: 'b_u1_wire_p', type: 'wire' },
    { from: 'b_u1_wire_OUT', to: 'b_q3_wire_b', type: 'wire' },
    { from: 'b_u1_wire_OUT', to: 'b_q1_wire_b', type: 'wire' },
    { from: 'b_u1_wire_OUT', to: 'b_q2_wire_b', type: 'wire' },
    { from: 'b_q3_wire_c', to: 'b_vcc_wire_p', type: 'wire' },
    { from: 'b_q3_wire_e', to: 'b_r4_wire_l', type: 'wire' },
    { from: 'b_r4_wire_r', to: 'b_gnd3_wire_gnd', type: 'wire' },
    { from: 'b_vcc_wire_n', to: 'b_gnd4_wire_gnd', type: 'wire' },
];

sys.stepsArray[1] = [
    {
        msg: "步骤 1：连接 Brokaw 温度传感器电路",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            for (let i = 0; i < brokawConns.length; i++) {
                await sys.addConnectionAnimated(brokawConns[i]);
            }
            sys.showFloatingTip("Brokaw 电路已自动搭建完成", 3000);
        },
        check: () => brokawConns.every(c =>
            sys.conns.some(sc => sys._connEqual(sc, c))
        )
    },
    {
        msg: "步骤 2：开启+15V电源，电路开始工作",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const vcc = sys.comps['b_vcc'];
            if (vcc) {
                vcc.isOn = true;
                vcc.update();
            }
            sys.showFloatingTip("电源已开启，Brokaw 电路工作", 3000);
        },
        check: () => {
            const vcc = sys.comps['b_vcc'];
            return vcc && vcc.isOn;
        }
    },
    {
        msg: "步骤 3：设定 T=0°C，观察输出",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const slider = document.getElementById('tempSlider');
            const display = document.getElementById('tempDisplay');
            if (slider) { slider.value = 0; }
            sys.globalTemp = 0;
            if (display) { display.textContent = '0°C'; }
            // 等待物理引擎稳定
            await new Promise(resolve => setTimeout(resolve, 3000));
            const vOut = sys.getVoltageBetween('b_q3_wire_e', 'b_gnd3_wire_gnd');
            const meter = sys.comps['b_meter'];
            if (meter && meter.update) meter.update(0);
            sys.showFloatingTip(`T=0°C: Vout = ${(vOut || 0).toFixed(3)}V`, 4000);
        },
        check: () => true
    },
    {
        msg: "步骤 4：设定 T=25°C（室温），观察输出",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const slider = document.getElementById('tempSlider');
            const display = document.getElementById('tempDisplay');
            if (slider) { slider.value = 25; }
            sys.globalTemp = 25;
            if (display) { display.textContent = '25°C'; }
            await new Promise(resolve => setTimeout(resolve, 3000));
            const vOut = sys.getVoltageBetween('b_q3_wire_e', 'b_gnd3_wire_gnd');
            const meter = sys.comps['b_meter'];
            if (meter && meter.update) meter.update(25);
            sys.showFloatingTip(`T=25°C: Vout = ${(vOut || 0).toFixed(3)}V`, 4000);
        },
        check: () => true
    },
    {
        msg: "步骤 5：设定 T=50°C，观察输出",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const slider = document.getElementById('tempSlider');
            const display = document.getElementById('tempDisplay');
            if (slider) { slider.value = 50; }
            sys.globalTemp = 50;
            if (display) { display.textContent = '50°C'; }
            await new Promise(resolve => setTimeout(resolve, 3000));
            const vOut = sys.getVoltageBetween('b_q3_wire_e', 'b_gnd3_wire_gnd');
            const meter = sys.comps['b_meter'];
            if (meter && meter.update) meter.update(50);
            sys.showFloatingTip(`T=50°C: Vout = ${(vOut || 0).toFixed(3)}V`, 4000);
        },
        check: () => true
    },
    {
        msg: "步骤 6：设定 T=100°C，观察输出",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const slider = document.getElementById('tempSlider');
            const display = document.getElementById('tempDisplay');
            if (slider) { slider.value = 100; }
            sys.globalTemp = 100;
            if (display) { display.textContent = '100°C'; }
            await new Promise(resolve => setTimeout(resolve, 3000));
            const vOut = sys.getVoltageBetween('b_q3_wire_e', 'b_gnd3_wire_gnd');
            const meter = sys.comps['b_meter'];
            if (meter && meter.update) meter.update(100);
            sys.showFloatingTip(`T=100°C: Vout = ${(vOut || 0).toFixed(3)}V`, 4000);
        },
        check: () => true
    },
    {
        msg: "步骤 7：实验总结——Vout 正比于温度, 10mV/°C",
        act: async () => {
            await new Promise(resolve => setTimeout(resolve, 3000));
            sys.showFloatingTip(
                "Brokaw 温度传感器原理：\n" +
                "ΔVbe = Vt·ln(8), Vt = kT/q\n" +
                "Vout = (1+2R2/R1)·ΔVbe ≈ 10mV/°C",
                6000
            );
        },
        check: () => true
    },
];
```

- [ ] **Step 3: 修改 applyAllPresets 支持项目切换**

找到 `applyAllPresets()` 方法，修改为根据当前项目选择不同的预设连线：

```javascript
applyAllPresets() {
    const sys = this.sys;
    const taskSelect = document.getElementById('taskSelect');
    const project = taskSelect ? taskSelect.value : '0';

    if (project === '1') {
        // Brokaw 电路连线
        sys.conns = [
            { from: 'b_vcc_wire_p', to: 'b_r2_wire_l', type: 'wire' },
            { from: 'b_vcc_wire_p', to: 'b_r3_wire_l', type: 'wire' },
            { from: 'b_r2_wire_r', to: 'b_q1_wire_c', type: 'wire' },
            { from: 'b_r3_wire_r', to: 'b_q2_wire_c', type: 'wire' },
            { from: 'b_q1_wire_e', to: 'b_gnd1_wire_gnd', type: 'wire' },
            { from: 'b_q2_wire_e', to: 'b_r1_wire_l', type: 'wire' },
            { from: 'b_r1_wire_r', to: 'b_gnd2_wire_gnd', type: 'wire' },
            { from: 'b_q1_wire_c', to: 'b_u1_wire_n', type: 'wire' },
            { from: 'b_q2_wire_c', to: 'b_u1_wire_p', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q3_wire_b', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q1_wire_b', type: 'wire' },
            { from: 'b_u1_wire_OUT', to: 'b_q2_wire_b', type: 'wire' },
            { from: 'b_q3_wire_c', to: 'b_vcc_wire_p', type: 'wire' },
            { from: 'b_q3_wire_e', to: 'b_r4_wire_l', type: 'wire' },
            { from: 'b_r4_wire_r', to: 'b_gnd3_wire_gnd', type: 'wire' },
            { from: 'b_vcc_wire_n', to: 'b_gnd4_wire_gnd', type: 'wire' },
        ];
    } else {
        // 原 PTC 电路连线
        sys.conns = [
            { from: 'dcpower_wire_p', to: 'ptc_wire_l', type: 'wire' },
            { from: 'ptc_wire_r', to: 'load_wire_l', type: 'wire' },
            { from: 'load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        ];
    }

    sys.redrawAll();
}
```

- [ ] **Step 4: 修改 applyStartSystem 支持项目**

找到 `applyStartSystem()` 方法，修改为：

```javascript
async applyStartSystem() {
    const sys = this.sys;
    const taskSelect = document.getElementById('taskSelect');
    const project = taskSelect ? taskSelect.value : '0';

    if (project === '1') {
        const vcc = sys.comps['b_vcc'];
        if (vcc) {
            vcc.isOn = true;
            vcc.update();
            sys.showFloatingTip("Brokaw 电路电源已开启", 2000);
        }
    } else {
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
    }
}
```

- [ ] **Step 5: 修改 fiveStep 支持 Brokaw 温度循环**

找到 `fiveStep()` 方法，修改为：

```javascript
fiveStep() {
    const sys = this.sys;
    const taskSelect = document.getElementById('taskSelect');
    const project = taskSelect ? taskSelect.value : '0';

    if (project === '1') {
        // Brokaw: 温度循环 0 → 25 → 50 → 75 → 100 → 0
        const temps = [0, 25, 50, 75, 100];
        const currentTemp = sys.globalTemp || 0;
        let nextTemp = temps[0];
        for (const t of temps) {
            if (Math.abs(t - currentTemp) < 1) {
                const idx = temps.indexOf(t);
                nextTemp = temps[(idx + 1) % temps.length];
                break;
            }
        }
        sys.globalTemp = nextTemp;
        const slider = document.getElementById('tempSlider');
        const display = document.getElementById('tempDisplay');
        if (slider) slider.value = nextTemp;
        if (display) display.textContent = nextTemp.toFixed(0) + '°C';

        const vOut = sys.getVoltageBetween('b_q3_wire_e', 'b_gnd3_wire_gnd');
        const meter = sys.comps['b_meter'];
        if (meter && meter.update) meter.update(nextTemp);

        if (sys.showFloatingTip) {
            sys.showFloatingTip(
                `温度: ${nextTemp}°C  Vout: ${(vOut || 0).toFixed(3)}V`,
                3000
            );
        }
        return;
    }

    // 原 PTC 逻辑
    const dcpower = sys.comps['dcpower'];
    const ptc = sys.comps['ptc'];
    if (!dcpower) return;
    if (dcpower.isOn) {
        dcpower.isOn = false;
        dcpower.update();
        if (ptc) {
            ptc._autoMode = false;
            ptc._useManual = true;
            ptc._manualTemp = 25;
        }
        if (sys.showFloatingTip) {
            sys.showFloatingTip("电源关闭，PTC冷却恢复中", 2000);
        }
    } else {
        dcpower.isOn = true;
        dcpower.update();
        if (ptc) {
            ptc._autoMode = true;
            ptc._useManual = false;
            ptc._autoTemp = ptc.Tswitch + 15;
        }
        if (sys.showFloatingTip) {
            sys.showFloatingTip("PTC过温保护启动", 3000);
        }
    }
}
```

- [ ] **Step 6: 修改 switchWorkflow 以在项目切换时重置连线**

找到 `switchWorkflow()` 方法，在 `initSteps()` 附近寻找该方法的实现，确保在切换项目时：

1. 调用 `_switchProject()` 或 `_setProjectVisibility()`
2. 清空已有连线
3. 加载对应的 stepsArray

```javascript
// 修改 switchWorkflow 方法
switchWorkflow(taskValue) {
    const sys = this.sys;
    const projId = parseInt(taskValue) || 0;
    
    // 隐藏所有组件，显示当前项目组件
    sys._switchProject(projId);
    
    // 清空历史
    sys.history.clear();
    
    // 设置步骤
    sys.stepsArray[projId] = sys.stepsArray[projId] || [];
    // Workflow 面板会根据 workflowComp._workflow 自动使用当前步骤
}
```

### Task 5: 启动并验证

- [ ] **Step 1: 安装依赖并启动**

```bash
cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\tempsensorpn"
npm install
npm run dev
```

期望：Vite 开发服务器启动，浏览器打开后可看到画布。

- [ ] **Step 2: 浏览器中验证**

验证清单：
1. 工具栏显示 "温度: [=====○=====] 25°C" 滑块
2. 下拉选择 "2. Brokaw温度传感器仿真电路" → 画布切换显示 Brokaw 组件
3. 点击 "自动接线" → 16 条连线全部生成
4. 点击 "起动系统" → VCC 电源亮起
5. 点击 "5 点步进" → 温度在 0→25→50→75→100°C 间循环
6. 拖动温度滑块 → Vout 实时变化
7. 自动演示 → 7 步流程正常播放
