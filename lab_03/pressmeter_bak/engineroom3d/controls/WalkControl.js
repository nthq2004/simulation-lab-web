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
     * @param {Object} [options.bounds]        房间边界 { xMin, xMax, zMin, zMax }
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

        this._controls.addEventListener('lock', this._onLockChange);
        this._controls.addEventListener('unlock', this._onLockChange);
    }

    /** 启用漫游模式 */
    enable() {
        if (this._enabled) return;
        this._enabled = true;
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
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

        const delta = 1 / 60;
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
