import * as THREE from 'three';
import { CameraManager } from './controls/CameraManager.js';
import { ModelLoader } from './models/ModelLoader.js';
import { getStateColor } from './visualization/StateColors.js';
import { LabelSystem } from './visualization/LabelSystem.js';
import { AnimationManager } from './animation/AnimationManager.js';
import { EngineAnimator } from './animation/EngineAnimator.js';
import { FlowParticles } from './visualization/FlowParticles.js';

/**
 * EngineRoom3D - 3D 机舱场景主控
 * 管理 Three.js 场景、相机、渲染器和设备模型
 */
export class EngineRoom3D {
    /**
     * @param {HTMLElement} container  DOM 容器
     */
    constructor(container) {
        if (!container) throw new Error('EngineRoom3D: container is required');

        this.container = container;
        this._deviceMeshes = new Map();  // devId → THREE.Group
        this._modelLoader = new ModelLoader();
        this.labelSystem = new LabelSystem();
        this._animManager = new AnimationManager();
        this._lastTime = 0;
        this._equipmentPool = null;
        this._raycaster = new THREE.Raycaster();
        this._pointer = new THREE.Vector2();
        this._onDeviceClick = null;
        this._flowParticles = null;

        this._initScene();
        this._initCamera();
        this._initRenderer();
        this._initLights();
        this._initControls();
        this._initHelpers();

        // 启动渲染循环
        this._animate();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // 雾效
        this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 40);
    }

    _initCamera() {
        const rect = this.container.getBoundingClientRect();
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 100);
        this.camera.position.set(8, 6, 8);
        this.camera.lookAt(0, 0, 0);
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = false;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.container.appendChild(this.renderer.domElement);
        this.labelSystem.init(this.container);
    }

    _initLights() {
        // 环境光
        const ambient = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(ambient);

        // 主方向光（阴影已禁用，保留光照）
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(10, 15, 10);
        this.scene.add(dirLight);

        // 补光
        const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
        fillLight.position.set(-10, 5, -10);
        this.scene.add(fillLight);

        // 机舱顶部灯 (点光源阵列)
        for (let x = -6; x <= 6; x += 4) {
            for (let z = -6; z <= 6; z += 4) {
                const point = new THREE.PointLight(0xffeedd, 0.2, 8);
                point.position.set(x, 4, z);
                this.scene.add(point);
            }
        }
    }

    _initControls() {
        this.cameraManager = new CameraManager(this.camera, this.renderer.domElement);
        this.cameraManager.initOrbitControls();
    }

    _initHelpers() {
        // 网格地面
        const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355);
        grid.position.y = -0.01;
        this.scene.add(grid);

        // 地面平面
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 1 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.01;
        this.scene.add(ground);
    }

    /**
     * 添加设备模型到场景
     * @param {string} devId  设备 ID
     * @param {string} type   设备类型
     * @param {THREE.Vector3} position
     * @param {Object} opts
     */
    async addDevice(devId, type, position, opts = {}) {
        const mesh = this._modelLoader.createDevice(type, { color: getStateColor(), ...opts });
        mesh.position.copy(position);
        mesh.scale.setScalar(opts.scale || 1);
        this.scene.add(mesh);
        this._deviceMeshes.set(devId, mesh);

        // 创建设备悬浮标签
        const labelPos = position.clone().add(new THREE.Vector3(0, 1.2, 0));
        this.labelSystem.addLabel(devId, opts.label || devId, labelPos);

        // 柴油机注册动画驱动
        if (type === 'diesel_engine' && this._equipmentPool) {
            this._animManager.register(devId, new EngineAnimator(mesh, this._equipmentPool, devId));
        }

        return mesh;
    }

    /**
     * 设置设备对象池引用（数字孪生状态数据源）
     * @param {Object} pool  EquipmentPool 实例
     */
    setEquipmentPool(pool) {
        this._equipmentPool = pool;
    }

    /**
     * 更新设备 3D 颜色
     */
    updateDeviceState(devId, state) {
        const mesh = this._deviceMeshes.get(devId);
        if (!mesh) return;

        // 遍历更新材质颜色
        mesh.traverse(child => {
            if (child.isMesh && child.material) {
                const color = getStateColor({ state, alarms: state.alarms, running: state.running });
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.color.setHex(color));
                } else {
                    child.material.color.setHex(color);
                }
            }
        });
    }

    /**
     * 相机聚焦到设备
     */
    focusOn(devId) {
        const mesh = this._deviceMeshes.get(devId);
        if (!mesh) return;
        this.cameraManager.focusOn(mesh.position);
    }

    /** 重置场景 */
    reset() {
        this.cameraManager.reset();
    }

    /**
     * 更新设备标签文字
     */
    updateDeviceLabel(devId, text) {
        this.labelSystem.updateLabel(devId, text);
    }

    /**
     * 初始化 3D 设备点击检测（Raycaster）
     * @param {Function} onDeviceClick 回调，接收 devId
     */
    initClickDetection(onDeviceClick) {
        this._onDeviceClick = onDeviceClick;
        this.renderer.domElement.addEventListener('click', (event) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            this._raycaster.setFromCamera(this._pointer, this.camera);
            const meshes = [];
            this._deviceMeshes.forEach((group) => {
                group.traverse(child => {
                    if (child.isMesh) meshes.push(child);
                });
            });
            const intersects = this._raycaster.intersectObjects(meshes);
            if (intersects.length > 0) {
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

    /** 切换视角模式 */
    switchViewMode(mode) {
        switch (mode) {
            case 'orbit': this.cameraManager.switchToOrbit(); break;
            case 'walk':  this.cameraManager.switchToWalk();  break;
            case 'focus': break; // focus 由 focusOn() 触发
            default: break;
        }
    }

    /** 设置漫游控制器（由 WalkControl 在外部创建后注入） */
    setWalkControl(walkCtrl) {
        this.cameraManager.setWalkControl(walkCtrl);
    }

    /** 设置管路流体粒子系统 */
    setFlowParticles(fp) {
        this._flowParticles = fp;
    }

    /** 调整大小 */
    resize() {
        const rect = this.container.getBoundingClientRect();
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(rect.width, rect.height);
        this.labelSystem.resize(rect.width, rect.height);
    }

    _animate() {
        this._rafId = requestAnimationFrame(() => this._animate());

        const now = performance.now();
        const rawDt = this._lastTime ? (now - this._lastTime) / 1000 : 1 / 60;
        const dt = Math.min(rawDt, 1 / 15);
        this._lastTime = now;

        this.cameraManager.update();

        // ── 性能追踪（仅首次检测） ──
        if (!this._perfDone) {
            const t0 = performance.now();
            this._animManager.update(dt);
            const t1 = performance.now();
            if (this._flowParticles) this._flowParticles.update(dt);
            const t2 = performance.now();
            this.renderer.render(this.scene, this.camera);
            const t3 = performance.now();
            this.labelSystem.render(this.camera);
            const t4 = performance.now();
            const frameTime = t4 - t0;
            if (frameTime > 30) {
                console.warn(
                    `[3D Perf] 帧耗时 ${frameTime.toFixed(1)}ms:`,
                    `anim=${(t1-t0).toFixed(1)}ms`,
                    `particles=${(t2-t1).toFixed(1)}ms`,
                    `render=${(t3-t2).toFixed(1)}ms`,
                    `css2d=${(t4-t3).toFixed(1)}ms`
                );
            }
            this._perfDone = true;
            // 首次检测后恢复常规流程
            return;
        }

        this._animManager.update(dt);
        if (this._flowParticles) this._flowParticles.update(dt);

        // 主场景 WebGL 渲染（始终执行，保证交互流畅）
        this.renderer.render(this.scene, this.camera);

        // CSS2D 标签：相机未移动时每隔一帧渲染以减少 DOM 操作
        const camPos = this.camera.position;
        if (!this._labelCamPos) this._labelCamPos = new THREE.Vector3();
        const camMoved = this._labelCamPos.distanceToSquared(camPos) > 1e-8;
        if (camMoved || this._labelFrameCounter % 3 === 0) {
            if (camMoved) this._labelCamPos.copy(camPos);
            this.labelSystem.render(this.camera);
        }
        this._labelFrameCounter = (this._labelFrameCounter || 0) + 1;
    }

    /** 销毁 */
    dispose() {
        // 先保存引用，防止 renderer.dispose() 后 domElement 失效
        const domEl = this.renderer && this.renderer.domElement;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        if (this._flowParticles) this._flowParticles.clear();
        this._animManager = null;
        this._equipmentPool = null;
        if (this.cameraManager) this.cameraManager.dispose();
        if (this.labelSystem) this.labelSystem.dispose();
        if (this.renderer) this.renderer.dispose();
        if (domEl && domEl.parentNode) {
            domEl.parentNode.removeChild(domEl);
        }
    }
}
