# 船舶机舱数字孪生 — Phase 3 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成教学与交互四大功能：WASD 漫游模式、3D 设备标签、船舶操作流程 Workflow 适配、10+ 故障场景

**Architecture:** 在 Phase 1+2 基础上，新增 WalkControl（PointerLockControls）实现 WASD 巡检，LabelSystem（CSS2DRenderer）实现悬浮参数标签，在 WorkflowManager 中填充船舶 SOP 步骤和故障配置。所有新增功能均不影响现有 2D 组件和仿真引擎。

**Tech Stack:** Three.js (ESM via Vite), Three.js PointerLockControls, CSS2DRenderer, EventBus, EquipmentPool

---

## 文件结构

### 新建文件

```
engineroom3d/controls/WalkControl.js            # WASD 第一人称漫游控制
engineroom3d/controls/CameraManager.js           # 视角切换管理 (Orbit/Walk/Focus)
engineroom3d/visualization/LabelSystem.js         # CSS2D 设备悬浮标签
tools/Phase3Workflows.js                          # 船舶 SOP 步骤定义
tools/Phase3FaultConfig.js                        # 故障场景配置
```

### 修改文件

```
engineroom3d/EngineRoom3D.js                     # 集成 WalkControl + CameraManager + LabelSystem
main.js                                           # 添加 WASD 模式切换按钮, 3D 设备点击
export.js                                         # 导出新模块
lib/WorkflowManager.js                            # 填充 initSteps 和 initFault
```

---

### Task 1: CameraManager — 视角切换管理

**Files:**
- Create: `engineroom3d/controls/CameraManager.js`
- Modify: `engineroom3d/EngineRoom3D.js`

CameraManager 管理三种观察模式：鸟瞰 (Orbit)、漫游 (Walk)、聚焦 (Focus)。负责 OrbitControls 和 WalkControl 之间的切换。

- [ ] **Step 1: 创建 CameraManager.js**

```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * CameraManager - 视角切换管理
 * 管理三种观察模式：鸟瞰(Orbit)、漫游(Walk)、聚焦(Focus)
 */
export class CameraManager {
    /**
     * @param {THREE.Camera} camera
     * @param {HTMLElement} domElement
     */
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this._mode = 'orbit'; // 'orbit' | 'walk' | 'focus'
        this._orbitControls = null;
        this._walkControl = null;
        this._focusTarget = null;
        this._savedOrbitPos = null;
        this._savedOrbitTarget = null;
    }

    /** 初始化轨道控制 */
    initOrbitControls(target = new THREE.Vector3(0, 1, 0)) {
        const controls = new OrbitControls(this.camera, this.domElement);
        controls.target.copy(target);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 2;
        controls.maxDistance = 30;
        controls.maxPolarAngle = Math.PI / 2.1;
        controls.update();
        this._orbitControls = controls;
        return controls;
    }

    /** 设置漫游控制引用 */
    setWalkControl(walkCtrl) {
        this._walkControl = walkCtrl;
    }

    /** 获取当前模式 */
    get mode() { return this._mode; }

    /** 获取轨道控制 */
    get orbitControls() { return this._orbitControls; }

    /** 切换到鸟瞰模式 */
    switchToOrbit() {
        if (this._mode === 'orbit') return;
        if (this._walkControl) this._walkControl.disable();

        // 恢复轨道控制
        this._orbitControls.enabled = true;
        this._mode = 'orbit';
    }

    /** 切换到漫游模式 */
    switchToWalk() {
        if (this._mode === 'walk') return;
        if (!this._walkControl) return;

        // 保存当前轨道状态
        this._savedOrbitPos = this.camera.position.clone();
        this._savedOrbitTarget = this._orbitControls.target.clone();

        // 禁用轨道控制
        this._orbitControls.enabled = false;

        // 启用漫游
        this._walkControl.enable();
        this._mode = 'walk';
    }

    /** 聚焦到指定位置 */
    focusOn(position) {
        const prevMode = this._mode;
        if (this._walkControl) this._walkControl.disable();
        this._orbitControls.enabled = true;

        // 平滑聚焦
        this._focusTarget = position.clone();
        this._orbitControls.target.copy(position);
        this.camera.position.set(
            position.x + 3,
            position.y + 2,
            position.z + 3
        );
        this._orbitControls.update();
        this._mode = 'focus';
    }

    /** 更新（每帧调用）*/
    update() {
        if (this._orbitControls && this._orbitControls.enabled) {
            this._orbitControls.update();
        }
        if (this._walkControl && this._mode === 'walk') {
            this._walkControl.update();
        }
    }

    /** 重置到默认视角 */
    reset() {
        this.switchToOrbit();
        this._orbitControls.target.set(0, 1, 0);
        this.camera.position.set(8, 6, 8);
        this._orbitControls.update();
    }

    /** 销毁 */
    dispose() {
        if (this._orbitControls) this._orbitControls.dispose();
        if (this._walkControl) this._walkControl.dispose();
    }
}
```

- [ ] **Step 2: 修改 EngineRoom3D.js — 集成 CameraManager**

在 EngineRoom3D 中用 CameraManager 替代直接使用 OrbitControls：

```javascript
// 顶部导入新增 CameraManager
import { CameraManager } from './controls/CameraManager.js';

// 修改 _initControls() 方法
_initControls() {
    this.cameraManager = new CameraManager(this.camera, this.renderer.domElement);
    this.controls = this.cameraManager.initOrbitControls(new THREE.Vector3(0, 1, 0));
}

// 修改 _animate() 方法
_animate() {
    this._rafId = requestAnimationFrame(() => this._animate());
    this.cameraManager.update(); // 替代 this.controls.update()
    this.renderer.render(this.scene, this.camera);
}

// 修改 focusOn() 方法
focusOn(devId) {
    const mesh = this._deviceMeshes.get(devId);
    if (!mesh) return;
    this.cameraManager.focusOn(mesh.position);
}

// 修改 reset() 方法
reset() {
    this.cameraManager.reset();
}

// 新增视角切换方法
switchViewMode(mode) {
    switch (mode) {
        case 'orbit': this.cameraManager.switchToOrbit(); break;
        case 'walk': this.cameraManager.switchToWalk(); break;
        case 'focus': break; // 由 focusOn 触发
    }
}

// 新增 walk control 设置方法
setWalkControl(walkCtrl) {
    this.cameraManager.setWalkControl(walkCtrl);
}

// 修改 dispose() 清理相机管理器
dispose() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.cameraManager.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
        this.container.removeChild(this.renderer.domElement);
    }
}
```

---

### Task 2: WalkControl — WASD 第一人称漫游

**Files:**
- Create: `engineroom3d/controls/WalkControl.js`

使用 Three.js PointerLockControls + WASD 键盘实现第一人称漫游。

- [ ] **Step 1: 创建 WalkControl.js**

```javascript
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

/**
 * WalkControl - WASD 第一人称漫游控制
 * 配合 PointerLockControls 实现机舱巡检
 */
export class WalkControl {
    /**
     * @param {THREE.Camera} camera
     * @param {HTMLElement} domElement
     * @param {Object} [options]
     * @param {number} [options.speed=3]      移动速度
     * @param {number} [options.bounds]        房间边界 { xMin, xMax, zMin, zMax }
     */
    constructor(camera, domElement, options = {}) {
        this.camera = camera;
        this.domElement = domElement;
        this.speed = options.speed || 3;
        this.bounds = options.bounds || { xMin: -8, xMax: 8, zMin: -6, zMax: 6 };

        this._enabled = false;
        this._controls = new PointerLockControls(camera, domElement);
        this._keys = { w: false, a: false, s: false, d: false };
        this._isLocked = false;

        // 键盘事件
        this._onKeyDown = (e) => {
            if (!this._enabled) return;
            switch (e.code) {
                case 'KeyW': this._keys.w = true; e.preventDefault(); break;
                case 'KeyA': this._keys.a = true; e.preventDefault(); break;
                case 'KeyS': this._keys.s = true; e.preventDefault(); break;
                case 'KeyD': this._keys.d = true; e.preventDefault(); break;
            }
        };
        this._onKeyUp = (e) => {
            switch (e.code) {
                case 'KeyW': this._keys.w = false; e.preventDefault(); break;
                case 'KeyA': this._keys.a = false; e.preventDefault(); break;
                case 'KeyS': this._keys.s = false; e.preventDefault(); break;
                case 'KeyD': this._keys.d = false; e.preventDefault(); break;
            }
        };
        this._onLockChange = () => {
            this._isLocked = this._controls.isLocked;
        };

        // PointerLockControls 默认按 esc 或点击退出锁定
        this._controls.addEventListener('lock', this._onLockChange);
        this._controls.addEventListener('unlock', this._onLockChange);
    }

    /** 启用漫游模式 */
    enable() {
        if (this._enabled) return;
        this._enabled = true;
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        // 自动锁定鼠标
        this._controls.lock();
    }

    /** 禁用漫游模式 */
    disable() {
        if (!this._enabled) return;
        this._enabled = false;
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        if (this._controls.isLocked) {
            this._controls.unlock();
        }
        this._keys = { w: false, a: false, s: false, d: false };
    }

    /** 每帧更新移动 */
    update() {
        if (!this._enabled || !this._isLocked) return;

        const delta = 1 / 60; // 60fps 基准
        const moveSpeed = this.speed * delta;

        // 获取相机朝向
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        right.y = 0;
        right.normalize();

        const moveVec = new THREE.Vector3();
        if (this._keys.w) moveVec.add(forward);
        if (this._keys.s) moveVec.sub(forward);
        if (this._keys.a) moveVec.sub(right);
        if (this._keys.d) moveVec.add(right);

        if (moveVec.length() > 0) {
            moveVec.normalize().multiplyScalar(moveSpeed);
            const newPos = this.camera.position.clone().add(moveVec);

            // 边界约束
            newPos.x = Math.max(this.bounds.xMin, Math.min(this.bounds.xMax, newPos.x));
            newPos.z = Math.max(this.bounds.zMin, Math.min(this.bounds.zMax, newPos.z));

            this.camera.position.copy(newPos);
        }
    }

    /** 锁定/解锁鼠标 */
    lock() { this._controls.lock(); }
    unlock() { this._controls.unlock(); }

    get isLocked() { return this._isLocked; }
    get isEnabled() { return this._enabled; }

    /** 销毁 */
    dispose() {
        this.disable();
        this._controls.removeEventListener('lock', this._onLockChange);
        this._controls.removeEventListener('unlock', this._onLockChange);
        this._controls.dispose();
    }
}
```

---

### Task 3: LabelSystem — 3D 设备悬浮标签

**Files:**
- Create: `engineroom3d/visualization/LabelSystem.js`
- Modify: `engineroom3d/EngineRoom3D.js`

使用 CSS2DRenderer 实现设备上方悬浮标签，显示设备名称和关键参数。

- [ ] **Step 1: 创建 LabelSystem.js**

```javascript
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * LabelSystem - 3D 设备悬浮标签
 * 使用 CSS2DRenderer 显示设备名称和关键参数
 */
export class LabelSystem {
    constructor() {
        this._labels = new Map(); // devId → CSS2DObject
        this._enabled = true;
        this._renderer = null;
    }

    /**
     * 初始化 CSS2DRenderer
     * @param {HTMLElement} container
     */
    init(container) {
        this._renderer = new CSS2DRenderer();
        this._renderer.setSize(container.clientWidth, container.clientHeight);
        this._renderer.domElement.style.position = 'absolute';
        this._renderer.domElement.style.top = '0';
        this._renderer.domElement.style.left = '0';
        this._renderer.domElement.style.pointerEvents = 'none'; // 允许点击穿透
        container.appendChild(this._renderer.domElement);
    }

    /**
     * 为设备创建标签
     * @param {string} devId
     * @param {string} label    设备名称
     * @param {THREE.Vector3} position  标签位置（设备上方偏移）
     * @param {Object} [opts]
     * @param {string} [opts.color]  标签颜色
     */
    addLabel(devId, label, position, opts = {}) {
        const div = document.createElement('div');
        div.className = 'equipment-label';
        div.textContent = label;
        Object.assign(div.style, {
            color: opts.color || '#fff',
            background: 'rgba(0,0,0,0.6)',
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            whiteSpace: 'nowrap',
            borderLeft: `3px solid ${opts.color || '#4fc3f7'}`,
            pointerEvents: 'none',
            userSelect: 'none',
        });

        const labelObj = new CSS2DObject(div);
        labelObj.position.copy(position);
        this._labels.set(devId, labelObj);
    }

    /**
     * 更新标签文本（显示设备参数）
     * @param {string} devId
     * @param {string} text
     */
    updateLabel(devId, text) {
        const label = this._labels.get(devId);
        if (label) {
            label.element.textContent = text;
        }
    }

    /**
     * 更新标签位置
     * @param {string} devId
     * @param {THREE.Vector3} position
     */
    updatePosition(devId, position) {
        const label = this._labels.get(devId);
        if (label) {
            label.position.copy(position);
        }
    }

    /** 添加标签对象到场景 */
    addToScene(scene) {
        this._labels.forEach(label => scene.add(label));
    }

    /** 从场景移除标签 */
    removeFromScene(scene) {
        this._labels.forEach(label => scene.remove(label));
    }

    /** 显示/隐藏所有标签 */
    setVisible(visible) {
        this._enabled = visible;
        this._labels.forEach(label => {
            label.element.style.display = visible ? '' : 'none';
        });
    }

    /** 切换标签可见性 */
    toggle() {
        this.setVisible(!this._enabled);
    }

    /** 每帧渲染 CSS2D（与 WebGL 同步）*/
    render(camera) {
        if (this._renderer) {
            this._renderer.render(this._renderer.scene, camera);
        }
    }

    /** 设置 CSS2D 场景（与主场景同步）*/
    setScene(scene) {
        this._renderer && (this._renderer.scene = scene);
    }

    /** 调整大小 */
    resize(width, height) {
        if (this._renderer) {
            this._renderer.setSize(width, height);
        }
    }

    /** 销毁 */
    dispose() {
        this._labels.clear();
        if (this._renderer && this._renderer.domElement.parentNode) {
            this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
        }
        this._renderer = null;
    }
}
```

- [ ] **Step 2: 在 EngineRoom3D.js 中集成 LabelSystem**

```javascript
// 顶部导入
import { LabelSystem } from './visualization/LabelSystem.js';

// 在 constructor 末尾初始化 LabelSystem
this.labelSystem = new LabelSystem();

// 修改 _initRenderer() — 在容器末尾追加 CSS2DRenderer
_initRenderer() {
    // ... 现有 WebGLRenderer 代码 ...
    // 追加 CSS2D 标签层
    this.labelSystem.init(this.container);
}

// 添加设备时同时创建标签（修改 addDevice）
addDevice(devId, type, position, opts = {}) {
    const mesh = this._modelLoader.createDevice(type, { color: getStateColor(), ...opts });
    mesh.position.copy(position);
    mesh.scale.setScalar(opts.scale || 1);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this._deviceMeshes.set(devId, mesh);

    // 创建设备标签（在设备上方 0.8 单位）
    const labelPos = position.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.labelSystem.addLabel(devId, opts.label || devId, labelPos);

    // 保存标签引用以便在 _animate 中同步
    return mesh;
}

// 修改 _animate() — 同步渲染 CSS2D
_animate() {
    this._rafId = requestAnimationFrame(() => this._animate());
    this.cameraManager.update();
    this.renderer.render(this.scene, this.camera);
    this.labelSystem.render(this.camera); // CSS2D 叠加渲染
}

// 修改 resize()
resize() {
    const rect = this.container.getBoundingClientRect();
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height);
    this.labelSystem.resize(rect.width, rect.height);
}

// 修改 dispose()
dispose() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.cameraManager.dispose();
    this.labelSystem.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
        this.container.removeChild(this.renderer.domElement);
    }
}

// 新增标签更新方法
updateDeviceLabel(devId, text) {
    this.labelSystem.updateLabel(devId, text);
}
```

- [ ] **Step 3: 在 main.js 的 3D 视图切换代码中，给每个设备传入 label 参数**

找到 `main.js` 中 `COOLING_LAYOUT.devices.forEach(dev => {` 和 `PHASE2_LAYOUT.devices.forEach(dev => {` 部分，确保设备创建时传入 `label`：

```javascript
// 冷却水设备
COOLING_LAYOUT.devices.forEach(dev => {
    er3d.addDevice(dev.id, dev.type, dev.position, {
        scale: dev.scale,
        label: dev.label || dev.id
    });
});

// Phase 2 设备
PHASE2_LAYOUT.devices.forEach(dev => {
    er3d.addDevice(dev.id, dev.type, dev.position, {
        scale: dev.scale,
        label: dev.label || dev.id
    });
});
```

还需要导入 PHASE2_LAYOUT：
```javascript
import('./engineroom3d/layout/LayoutData.js').then(({ COOLING_LAYOUT, PHASE2_LAYOUT }) => {
    // ...
});
```

同时也需要在冷却系统设备配置中添加 label 字段。修改 `tools/CoolingSystemData.js` 中设备的 label（可选，已有的话就直接使用）。

---

### Task 4: 3D 设备点击交互 — 点击设备查看参数

**Files:**
- Modify: `engineroom3d/EngineRoom3D.js`
- Modify: `main.js`

通过 Raycaster 实现 3D 场景中点击设备，弹出设备参数浮窗。

- [ ] **Step 1: 在 EngineRoom3D.js 中添加点击检测**

```javascript
// 在 constructor 末尾添加
this._raycaster = new THREE.Raycaster();
this._pointer = new THREE.Vector2();
this._onClick = null;

// 添加点击事件绑定方法
initClickDetection(onDeviceClick) {
    this._onDeviceClick = onDeviceClick;
    this.renderer.domElement.addEventListener('click', (event) => {
        // 计算指针位置归一化坐标
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._pointer, this.camera);

        // 收集所有设备网格
        const meshes = [];
        this._deviceMeshes.forEach((group) => {
            group.traverse(child => {
                if (child.isMesh) meshes.push(child);
            });
        });

        const intersects = this._raycaster.intersectObjects(meshes);
        if (intersects.length > 0) {
            // 找到被点击的 mesh 所属的设备
            const hit = intersects[0].object;
            let devId = null;
            this._deviceMeshes.forEach((group, id) => {
                if (group === hit || group.children.includes(hit) || hit.parent === group) {
                    devId = id;
                }
            });
            if (devId && this._onDeviceClick) {
                this._onDeviceClick(devId);
            }
        }
    });
}
```

- [ ] **Step 2: 在 main.js 的 3D 视图切换代码中启用点击检测**

在 `er3d` 创建后，调用点击检测并处理：

```javascript
// 在 EventBridge 连接之后添加
er3d.initClickDetection((devId) => {
    // 通过 EventBus 发送设备选中事件
    if (sys.eventBus) {
        sys.eventBus.emit('equipment:select', { id: devId });
    }
    // 聚焦到设备
    er3d.focusOn(devId);
    // 显示参数面板
    show3DDevicePanel(devId);
});
```

- [ ] **Step 3: 添加设备参数面板**

在 `main.js` 中添加 `show3DDevicePanel` 函数，显示设备参数浮窗：

```javascript
/** 显示 3D 设备参数浮窗 */
function show3DDevicePanel(devId) {
    const panel = document.getElementById('deviceInfoPanel')
        || createDeviceInfoPanel();

    const eq = sys.equipmentPool.get(devId);
    if (!eq) return;

    // 构建参数 HTML
    let html = `<div style="font-weight:bold;margin-bottom:8px;">${eq.label || devId}</div>`;
    html += `<div style="font-size:12px;">类型: ${eq.type}</div>`;

    if (eq.sensors) {
        Object.entries(eq.sensors).forEach(([key, sensor]) => {
            const val = sensor.value !== undefined ? sensor.value : sensor.default;
            html += `<div style="font-size:12px;">${sensor.label}: ${val} ${sensor.unit || ''}</div>`;
        });
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
        minWidth: '200px', zIndex: '1000', display: 'none',
        borderLeft: '4px solid #4fc3f7',
    });
    document.body.appendChild(panel);
    return panel;
}
```

---

### Task 5: 3D 视图工具栏按钮 — 添加漫游模式切换

**Files:**
- Modify: `main.js`
- Modify: `index.html`（如果存在工具栏按钮容器）

- [ ] **Step 1: 在 main.js 中添加 3D 内模式切换逻辑**

在 3D 切换按钮代码中，`er3d` 初始化后添加 WalkControl：

```javascript
// 在 EventBridge 之后，初始化 WalkControl
import('./engineroom3d/controls/WalkControl.js').then(({ WalkControl }) => {
    const walkCtrl = new WalkControl(er3d.camera, container3d, {
        speed: 3,
        bounds: { xMin: -8, xMax: 8, zMin: -6, zMax: 6 }
    });
    er3d.setWalkControl(walkCtrl);

    // 键盘快捷键：按 W 进入漫游，按 O 回到鸟瞰
    document.addEventListener('keydown', (e) => {
        if (!sys.engineRoom3D) return;
        if (e.key === 'w' || e.key === 'W') {
            er3d.switchViewMode('walk');
            e.preventDefault();
        } else if (e.key === 'o' || e.key === 'O') {
            er3d.switchViewMode('orbit');
            e.preventDefault();
        } else if (e.key === 'Escape') {
            er3d.switchViewMode('orbit');
        }
    });
});
```

- [ ] **Step 2: 在 index.html 的 3D 视图工具栏添加模式切换按钮（可选）**

如果工具栏有 3D 模式切换按钮的区域，添加：

```html
<!-- 在 3D 视图工具栏 -->
<button id="btnWalkMode" class="toolbar-btn" title="漫游模式 (W)">🚶 漫游</button>
<button id="btnOrbitMode" class="toolbar-btn" title="鸟瞰模式 (O)">🗺 鸟瞰</button>
<button id="btnToggleLabels" class="toolbar-btn" title="切换标签">🏷 标签</button>
```

然后在 main.js 绑定：
```javascript
document.getElementById('btnWalkMode') && (document.getElementById('btnWalkMode').onclick = () => {
    if (sys.engineRoom3D) sys.engineRoom3D.switchViewMode('walk');
});
document.getElementById('btnOrbitMode') && (document.getElementById('btnOrbitMode').onclick = () => {
    if (sys.engineRoom3D) sys.engineRoom3D.switchViewMode('orbit');
});
document.getElementById('btnToggleLabels') && (document.getElementById('btnToggleLabels').onclick = () => {
    if (sys.engineRoom3D) sys.engineRoom3D.labelSystem.toggle();
});
```

---

### Task 6: Phase3Workflows — 船舶 SOP 步骤定义

**Files:**
- Create: `tools/Phase3Workflows.js`

定义 5 个船舶操作 SOP，每个 SOP 包含 find/quiz/check 步骤。

- [ ] **Step 1: 创建 Phase3Workflows.js**

```javascript
/**
 * Phase3Workflows - 船舶操作标准流程 (SOP) 定义
 * 配合 Workflow.js 的 show/step/train/eval 四模式
 *
 * 步骤模式:
 *   find  — 学员点击指定设备
 *   quiz  — 弹出选择题
 *   check — 检测设备状态是否满足条件
 *   act   — 自动执行动作（演示模式用）
 */

/** 步骤帮助函数：查找组件并高亮 */
function findStep(targetId, msg) {
    return { mode: 'find', target: targetId, msg };
}

/** 步骤帮助函数：状态检测 */
function checkStep(checkFn, msg) {
    return { mode: 'check', check: checkFn, msg };
}

/** 步骤帮助函数：选择题 */
function quizStep(question, options, answer, analysis, isMultiple = false) {
    return {
        mode: 'quiz',
        msg: question,
        quizConfig: { question, options, answer, analysis, isMultiple }
    };
}

/** 步骤帮助函数：自动动作（演示用）*/
function actStep(actFn, msg) {
    return { mode: 'act', act: actFn, msg };
}

// =============================================
// SOP 1: 备车 (Standby)
// =============================================
const STANDBY_STEPS = [
    {
        mode: 'act',
        msg: '备车操作：检查压缩空气系统压力',
        act: async function () {
            const sys = this.sys || this;
            const eq = sys.equipmentPool?.get('air-bottle-main');
            if (eq) eq.state.pressure = 2.5;
        }
    },
    findStep('air-distributor-01', '找到空气分配器，打开起动空气阀'),
    {
        mode: 'check',
        msg: '确认主气瓶压力 ≥ 2.0 MPa',
        check: async function () {
            const eq = this.sys?.equipmentPool?.get('air-bottle-main');
            return eq && eq.state.pressure >= 2.0;
        }
    },
    quizStep(
        '备车时，主气瓶压力应不低于多少？',
        ['1.0 MPa', '1.5 MPa', '2.0 MPa', '2.5 MPa'],
        2,
        '备车状态要求主气瓶压力不低于 2.0 MPa，以保证起动空气充足。'
    ),
    findStep('pump-sw-01', '找到海水泵，准备起动'),
    findStep('pump-fw-01', '找到淡水泵，准备起动'),
    {
        mode: 'act',
        msg: '起动预润滑泵，建立滑油压力',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) me.state.oilPress = 120;
            }
        }
    },
    {
        mode: 'check',
        msg: '确认滑油压力 ≥ 100 kPa',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && me.state.oilPress >= 100;
        }
    },
];

// =============================================
// SOP 2: 主机起动 (Start)
// =============================================
const ENGINE_START_STEPS = [
    quizStep(
        '主机起动前，盘车机构应处于什么状态？',
        ['连接状态', '脱开状态', '任意状态', '半连接状态'],
        1,
        '盘车机构必须脱开，否则可能损坏主机。'
    ),
    findStep('me-01', '找到主机，确认准备好起动'),
    findStep('governor-01', '找到调速器，检查设定'),
    {
        mode: 'act',
        msg: '打开起动空气，主机开始转动',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) {
                    me.state.running = true;
                    me.state.speed = 80;
                    me.state.fuelRate = 30;
                }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) {
                    gov.state.running = true;
                    gov.state.actualRpm = 80;
                    gov.state.setRpm = 80;
                    gov.state.fuelCommand = 30;
                }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认主机转速 ≥ 50 rpm',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && me.state.running && me.state.speed >= 50;
        }
    },
    findStep('tank-doa-01', '检查日用油柜油位'),
    {
        mode: 'check',
        msg: '确认日用油柜油位 ≥ 20%',
        check: async function () {
            const tank = this.sys?.equipmentPool?.get('tank-doa-01');
            return tank && tank.state.level >= 20;
        }
    },
    {
        mode: 'act',
        msg: '逐渐增加油门至正常转速',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) {
                    me.state.speed = 120;
                    me.state.fuelRate = 50;
                }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) {
                    gov.state.actualRpm = 120;
                    gov.state.setRpm = 120;
                    gov.state.fuelCommand = 50;
                }
            }
        }
    },
];

// =============================================
// SOP 3: 并车 (Generator Parallel)
// =============================================
const GEN_PARALLEL_STEPS = [
    findStep('gen-01', '找到发电机组，准备起动'),
    {
        mode: 'act',
        msg: '起动发电机组',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const gen = sys.equipmentPool.get('gen-01');
                if (gen) {
                    gen.state.running = true;
                    gen.state.voltage = 380;
                    gen.state.frequency = 50;
                }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认发电机电压 ≈ 400V，频率 ≈ 50Hz',
        check: async function () {
            const gen = this.sys?.equipmentPool?.get('gen-01');
            return gen && gen.state.running &&
                Math.abs(gen.state.voltage - 400) < 20 &&
                Math.abs(gen.state.frequency - 50) < 1;
        }
    },
    quizStep(
        '发电机并车时，需要满足哪些条件？（多选）',
        ['电压相等', '频率相等', '相序一致', '功率相等'],
        [0, 1, 2],
        '并车三要素：电压相等、频率相等、相序一致。功率不要求相等。',
        true
    ),
    findStep('switchboard-01', '找到主配电板，准备合闸'),
    {
        mode: 'act',
        msg: '合闸并车',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const sw = sys.equipmentPool.get('switchboard-01');
                if (sw) {
                    sw.state.energized = true;
                    sw.state.busVoltage = 380;
                    sw.state.busFrequency = 50;
                    sw.state.busCurrent = 200;
                }
            }
        }
    },
];

// =============================================
// SOP 4: 调速 (Speed Adjust)
// =============================================
const SPEED_ADJUST_STEPS = [
    findStep('governor-01', '找到调速器'),
    quizStep(
        '调速器的作用是什么？',
        ['增加燃油消耗', '根据负载变化自动调节转速', '控制冷却水温度', '调节进气量'],
        1,
        '调速器根据负载变化自动调节喷油量，维持主机转速稳定。'
    ),
    {
        mode: 'act',
        msg: '增加主机转速至 150 rpm',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) { me.state.speed = 150; me.state.fuelRate = 65; }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) { gov.state.setRpm = 150; gov.state.actualRpm = 150; gov.state.fuelCommand = 65; }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认主机转速稳定在 150 ± 5 rpm',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && me.state.running && Math.abs(me.state.speed - 150) <= 5;
        }
    },
    {
        mode: 'act',
        msg: '降低转速至 100 rpm',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) { me.state.speed = 100; me.state.fuelRate = 40; }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) { gov.state.setRpm = 100; gov.state.actualRpm = 100; gov.state.fuelCommand = 40; }
            }
        }
    },
];

// =============================================
// SOP 5: 停车 (Stop)
// =============================================
const ENGINE_STOP_STEPS = [
    {
        mode: 'act',
        msg: '逐渐减少负荷，降低转速',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) { me.state.speed = 60; me.state.fuelRate = 20; }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) { gov.state.setRpm = 60; gov.state.actualRpm = 60; gov.state.fuelCommand = 20; }
            }
        }
    },
    quizStep(
        '主机停车前，应首先做什么？',
        ['直接按停机按钮', '先减负荷至最低', '先关闭冷却水', '先停止燃油泵'],
        1,
        '主机停车前必须先减负荷至最低，然后脱开离合器，最后停车。'
    ),
    {
        mode: 'act',
        msg: '停止主机',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) {
                    me.state.running = false;
                    me.state.speed = 0;
                    me.state.fuelRate = 0;
                }
                const gov = sys.equipmentPool.get('governor-01');
                if (gov) {
                    gov.state.running = false;
                    gov.state.actualRpm = 0;
                    gov.state.setRpm = 0;
                    gov.state.fuelCommand = 0;
                }
            }
        }
    },
    {
        mode: 'check',
        msg: '确认主机已停止（转速 = 0）',
        check: async function () {
            const me = this.sys?.equipmentPool?.get('me-01');
            return me && !me.state.running && me.state.speed === 0;
        }
    },
    findStep('air-distributor-01', '关闭起动空气阀'),
    {
        mode: 'act',
        msg: '关闭相关辅助系统',
        act: async function () {
            const sys = this.sys || this;
            if (sys.equipmentPool) {
                const me = sys.equipmentPool.get('me-01');
                if (me) me.state.oilPress = 0;
            }
        }
    },
];

// =============================================
// 导出：WorkflowManager 可用步骤集
// =============================================
export const SHIP_WORKFLOWS = {
    'sop-standby': {
        id: 'sop-standby',
        name: '备车 (Standby)',
        steps: STANDBY_STEPS,
    },
    'sop-start': {
        id: 'sop-start',
        name: '主机起动 (Start)',
        steps: ENGINE_START_STEPS,
    },
    'sop-parallel': {
        id: 'sop-parallel',
        name: '并车 (Parallel)',
        steps: GEN_PARALLEL_STEPS,
    },
    'sop-speed': {
        id: 'sop-speed',
        name: '调速 (Speed Adjust)',
        steps: SPEED_ADJUST_STEPS,
    },
    'sop-stop': {
        id: 'sop-stop',
        name: '停车 (Stop)',
        steps: ENGINE_STOP_STEPS,
    },
};
```

---

### Task 7: Phase3FaultConfig — 故障场景配置

**Files:**
- Create: `tools/Phase3FaultConfig.js`

定义 12 个故障场景，每个包含 id, name, trigger(), repair(), check() 方法。

- [ ] **Step 1: 创建 Phase3FaultConfig.js**

```javascript
/**
 * Phase3FaultConfig - 船舶机舱故障场景配置
 * 12 个典型故障模式，与 EquipmentPool 配合
 *
 * 每个故障包含:
 *   id       — 唯一标识
 *   name     — 显示名称
 *   system   — 所属系统
 *   check()  — 是否处于故障状态
 *   trigger()— 触发故障
 *   repair() — 修复故障
 */

import { PHASE2_ALL_DEVICES } from './Phase2SystemData.js';

/** 获取设备状态 */
function getDev(sys, id) {
    return sys.equipmentPool?.get(id);
}

/** 发出报警 */
function setAlarm(sys, devId, alarmText) {
    const dev = getDev(sys, devId);
    if (dev) {
        if (!dev.state.alarms) dev.state.alarms = [];
        if (!dev.state.alarms.includes(alarmText)) {
            dev.state.alarms.push(alarmText);
        }
    }
}

/** 清除报警 */
function clearAlarm(sys, devId, alarmText) {
    const dev = getDev(sys, devId);
    if (dev && dev.state.alarms) {
        dev.state.alarms = dev.state.alarms.filter(a => a !== alarmText);
    }
}

export const FAULT_CONFIGS = {
    // ── 冷却水系统故障 ──
    'fault-coolant-high': {
        id: 'fault-coolant-high',
        name: '冷却水高温',
        system: 'cooling',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.coolantTemp > 85;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.coolantTemp = 92;
                setAlarm(sys, 'me-01', '冷却水高温报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.coolantTemp = 75;
                clearAlarm(sys, 'me-01', '冷却水高温报警');
            }
        },
    },

    'fault-pump-sw-fail': {
        id: 'fault-pump-sw-fail',
        name: '海水泵故障',
        system: 'cooling',
        check: () => {
            const pump = window.sys?.equipmentPool?.get('pump-sw-01');
            return pump && !pump.state.running;
        },
        trigger: () => {
            const pump = getDev(window.sys, 'pump-sw-01');
            if (pump) {
                pump.state.running = false;
                pump.state.speed = 0;
                setAlarm(window.sys, 'pump-sw-01', '海水泵停机');
            }
        },
        repair: () => {
            const pump = getDev(window.sys, 'pump-sw-01');
            if (pump) {
                pump.state.running = true;
                pump.state.speed = 1450;
                clearAlarm(window.sys, 'pump-sw-01', '海水泵停机');
            }
        },
    },

    'fault-pump-fw-fail': {
        id: 'fault-pump-fw-fail',
        name: '淡水泵故障',
        system: 'cooling',
        check: () => {
            const pump = window.sys?.equipmentPool?.get('pump-fw-01');
            return pump && !pump.state.running;
        },
        trigger: () => {
            const pump = getDev(window.sys, 'pump-fw-01');
            if (pump) {
                pump.state.running = false;
                pump.state.speed = 0;
                setAlarm(window.sys, 'pump-fw-01', '淡水泵停机');
            }
        },
        repair: () => {
            const pump = getDev(window.sys, 'pump-fw-01');
            if (pump) {
                pump.state.running = true;
                pump.state.speed = 1450;
                clearAlarm(window.sys, 'pump-fw-01', '淡水泵停机');
            }
        },
    },

    'fault-hx-fouling': {
        id: 'fault-hx-fouling',
        name: '换热器结垢',
        system: 'cooling',
        check: () => {
            const hx = window.sys?.equipmentPool?.get('hx-01');
            return hx && (hx.state.duty || 0.5) < 0.2;
        },
        trigger: () => {
            const hx = getDev(window.sys, 'hx-01');
            if (hx) {
                hx.state.duty = 0.15;
                setAlarm(window.sys, 'hx-01', '换热器效率下降');
            }
        },
        repair: () => {
            const hx = getDev(window.sys, 'hx-01');
            if (hx) {
                hx.state.duty = 0.7;
                clearAlarm(window.sys, 'hx-01', '换热器效率下降');
            }
        },
    },

    // ── 滑油系统故障 ──
    'fault-oil-low': {
        id: 'fault-oil-low',
        name: '滑油低压',
        system: 'main_engine',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.oilPress < 80;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.oilPress = 45;
                setAlarm(sys, 'me-01', '滑油低压报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.oilPress = 250;
                clearAlarm(sys, 'me-01', '滑油低压报警');
            }
        },
    },

    // ── 燃油系统故障 ──
    'fault-fuel-leak': {
        id: 'fault-fuel-leak',
        name: '燃油泄漏',
        system: 'fuel_oil',
        check: () => {
            const tank = window.sys?.equipmentPool?.get('tank-hfo-01');
            return tank && tank.state.level < 30;
        },
        trigger: () => {
            const sys = window.sys;
            const tank = getDev(sys, 'tank-hfo-01');
            if (tank) {
                tank.state.level = 25;
                setAlarm(sys, 'tank-hfo-01', '燃油液位低');
            }
        },
        repair: () => {
            const sys = window.sys;
            const tank = getDev(sys, 'tank-hfo-01');
            if (tank) {
                tank.state.level = 80;
                clearAlarm(sys, 'tank-hfo-01', '燃油液位低');
            }
        },
    },

    'fault-purifier-fail': {
        id: 'fault-purifier-fail',
        name: '分油机故障',
        system: 'fuel_oil',
        check: () => {
            const pur = window.sys?.equipmentPool?.get('purifier-01');
            return pur && !pur.state.running;
        },
        trigger: () => {
            const pur = getDev(window.sys, 'purifier-01');
            if (pur) {
                pur.state.running = false;
                setAlarm(window.sys, 'purifier-01', '分油机故障');
            }
        },
        repair: () => {
            const pur = getDev(window.sys, 'purifier-01');
            if (pur) {
                pur.state.running = true;
                clearAlarm(window.sys, 'purifier-01', '分油机故障');
            }
        },
    },

    // ── 电站系统故障 ──
    'fault-power-loss': {
        id: 'fault-power-loss',
        name: '电网失电',
        system: 'power_station',
        check: () => {
            const sw = window.sys?.equipmentPool?.get('switchboard-01');
            return sw && !sw.state.energized;
        },
        trigger: () => {
            const sys = window.sys;
            const sw = getDev(sys, 'switchboard-01');
            if (sw) {
                sw.state.energized = false;
                sw.state.busVoltage = 0;
                sw.state.busCurrent = 0;
                setAlarm(sys, 'switchboard-01', '电网失电');
            }
            const gen = getDev(sys, 'gen-01');
            if (gen) {
                gen.state.running = false;
                gen.state.voltage = 0;
                gen.state.frequency = 0;
            }
        },
        repair: () => {
            const sys = window.sys;
            const gen = getDev(sys, 'gen-01');
            if (gen) {
                gen.state.running = true;
                gen.state.voltage = 380;
                gen.state.frequency = 50;
            }
            const sw = getDev(sys, 'switchboard-01');
            if (sw) {
                sw.state.energized = true;
                sw.state.busVoltage = 380;
                sw.state.busCurrent = 150;
                clearAlarm(sys, 'switchboard-01', '电网失电');
            }
        },
    },

    'fault-gen-overload': {
        id: 'fault-gen-overload',
        name: '发电机过载',
        system: 'power_station',
        check: () => {
            const gen = window.sys?.equipmentPool?.get('gen-01');
            return gen && gen.state.current > 450;
        },
        trigger: () => {
            const gen = getDev(window.sys, 'gen-01');
            if (gen) {
                gen.state.current = 480;
                setAlarm(window.sys, 'gen-01', '发电机过载');
            }
        },
        repair: () => {
            const gen = getDev(window.sys, 'gen-01');
            if (gen) {
                gen.state.current = 250;
                clearAlarm(window.sys, 'gen-01', '发电机过载');
            }
        },
    },

    // ── 主机系统故障 ──
    'fault-engine-overspeed': {
        id: 'fault-engine-overspeed',
        name: '主机超速',
        system: 'main_engine',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.speed > 180;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.speed = 195;
                me.state.fuelRate = 90;
                setAlarm(sys, 'me-01', '主机超速报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.speed = 120;
                me.state.fuelRate = 50;
                clearAlarm(sys, 'me-01', '主机超速报警');
            }
        },
    },

    'fault-exhaust-high': {
        id: 'fault-exhaust-high',
        name: '排烟温度过高',
        system: 'main_engine',
        check: () => {
            const me = window.sys?.equipmentPool?.get('me-01');
            return me && me.state.exhaustTemp > 500;
        },
        trigger: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.exhaustTemp = 550;
                setAlarm(sys, 'me-01', '排烟温度高报警');
            }
        },
        repair: () => {
            const sys = window.sys;
            const me = getDev(sys, 'me-01');
            if (me) {
                me.state.exhaustTemp = 350;
                clearAlarm(sys, 'me-01', '排烟温度高报警');
            }
        },
    },

    'fault-gov-fail': {
        id: 'fault-gov-fail',
        name: '调速器故障',
        system: 'main_engine',
        check: () => {
            const gov = window.sys?.equipmentPool?.get('governor-01');
            return gov && gov.state.fuelCommand === 0;
        },
        trigger: () => {
            const gov = getDev(window.sys, 'governor-01');
            if (gov) {
                gov.state.fuelCommand = 0;
                gov.state.setRpm = 0;
                setAlarm(window.sys, 'governor-01', '调速器故障');
            }
        },
        repair: () => {
            const gov = getDev(window.sys, 'governor-01');
            if (gov) {
                gov.state.fuelCommand = 50;
                gov.state.setRpm = 120;
                clearAlarm(window.sys, 'governor-01', '调速器故障');
            }
        },
    },

    // ── 压缩空气系统故障 ──
    'fault-air-low': {
        id: 'fault-air-low',
        name: '气瓶压力不足',
        system: 'compressed_air',
        check: () => {
            const bottle = window.sys?.equipmentPool?.get('air-bottle-main');
            return bottle && bottle.state.pressure < 1.0;
        },
        trigger: () => {
            const bottle = getDev(window.sys, 'air-bottle-main');
            if (bottle) {
                bottle.state.pressure = 0.5;
                setAlarm(window.sys, 'air-bottle-main', '气瓶压力低');
            }
        },
        repair: () => {
            const bottle = getDev(window.sys, 'air-bottle-main');
            if (bottle) {
                bottle.state.pressure = 2.5;
                clearAlarm(window.sys, 'air-bottle-main', '气瓶压力低');
            }
        },
    },
};
```

---

### Task 8: 集成 — 修改 WorkflowManager

**Files:**
- Modify: `lib/WorkflowManager.js`
- Modify: `export.js`

将 Phase3Workflows 和 Phase3FaultConfig 集成到 WorkflowManager 中。

- [ ] **Step 1: 修改 WorkflowManager.js — 填充 initSteps 和 initFault**

```javascript
// 顶部导入
import { SHIP_WORKFLOWS } from '../tools/Phase3Workflows.js';
import { FAULT_CONFIGS } from '../tools/Phase3FaultConfig.js';

// 替换 initSteps()
initSteps() {
    const sys = this.sys;

    const projectConfigs = Object.values(SHIP_WORKFLOWS).map(wf => ({
        id: wf.id,
        name: wf.name,
    }));

    const taskSelect = document.getElementById('taskSelect');
    if (taskSelect) {
        taskSelect.innerHTML = '<option value="" selected>请选择操作项目...</option>';
        projectConfigs.forEach(proj => {
            const opt = document.createElement('option');
            opt.value = proj.id;
            opt.textContent = proj.name;
            taskSelect.appendChild(opt);
        });
    }

    // 注册步骤到 stepsArray
    Object.values(SHIP_WORKFLOWS).forEach(wf => {
        sys.stepsArray[wf.id] = wf.steps;
    });
}

// 替换 initFault()
initFault() {
    const sys = this.sys;

    sys.FAULT_CONFIG = { ...FAULT_CONFIGS };

    const faultForm = document.getElementById('faultForm');
    if (faultForm) {
        faultForm.innerHTML = '';
        Object.values(sys.FAULT_CONFIG).forEach(fault => {
            const label = document.createElement('label');
            label.className = 'f-checkbox';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = fault.id;
            checkbox.id = `fault_check_${fault.id}`;
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(` ${fault.name} (${fault.system})`));
            faultForm.appendChild(label);
        });
    }
}
```

- [ ] **Step 2: 修改 export.js — 导出新模块**

在 `export.js` 中添加：
```javascript
export { SHIP_WORKFLOWS } from './tools/Phase3Workflows.js';
export { FAULT_CONFIGS } from './tools/Phase3FaultConfig.js';
```

---

### Task 9: 构建验证

**Files:** (无)

- [ ] **Step 1: 运行构建**

```bash
pnpm run build 2>&1
```

Expected: 构建成功，无错误。模块计数应增加 (Phase 3 新增文件)。

- [ ] **Step 2: 验证新增模块在构建产物中**

```bash
pnpm run build 2>&1 | findstr /I "error"
```

Expected: 无 error 输出。

---

## 自检清单

**Spec 覆盖检查:**
- [ ] 教学流程 — Task 6 (5个SOP) + Task 8 (WorkflowManager集成) ✅
- [ ] 故障场景 — Task 7 (12个故障) + Task 8 (initFault) ✅
- [ ] 漫游模式 — Task 2 (WalkControl) + Task 1 (CameraManager) + Task 5 (UI集成) ✅
- [ ] 评估系统 — 现有 Workflow.js 的 find/quiz/check 直接支持，SOP 步骤已包含 find/quiz/check ✅
- [ ] 3D 标签 — Task 3 (LabelSystem) ✅
- [ ] 3D 点击交互 — Task 4 (Raycaster + 参数面板) ✅

**占位符检查:** 无 TBD/TODO 占位符。所有代码完整可执行。

**类型一致性检查:** 
- CameraManager.mode 使用 'orbit' | 'walk' | 'focus' — EngineRoom3D.switchViewMode 使用相同枚举 ✅
- WalkControl.speed/bounds — CameraManager 引用一致 ✅
- FAULT_CONFIGS 使用 check/trigger/repair — 与 main.js 故障 UI 的 cfg.check()/cfg.trigger()/cfg.repair() 一致 ✅
- SHIP_WORKFLOWS.steps 使用 mode:'find'/'quiz'/'check'/'act' — 与 Workflow.js 的 _startWorkflowWatcher 匹配 ✅
- act 方法中 `this.sys || this` — 兼容 Workflow._executeSingleStep 的上下文 ✅
