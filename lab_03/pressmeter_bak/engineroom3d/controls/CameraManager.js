import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * CameraManager - 视角切换管理
 * 管理三种观察模式：鸟瞰(Orbit)、漫游(Walk)、聚焦(Focus)
 */
export class CameraManager {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this._mode = 'orbit';
        this._orbitControls = null;
        this._walkControl = null;
        this._focusTarget = null;
        this._savedOrbitPos = null;
        this._savedOrbitTarget = null;
    }

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

    setWalkControl(walkCtrl) { this._walkControl = walkCtrl; }
    get mode() { return this._mode; }
    get orbitControls() { return this._orbitControls; }

    switchToOrbit() {
        if (this._mode === 'orbit') return;
        if (this._walkControl) this._walkControl.disable();
        this._orbitControls.enabled = true;
        this._mode = 'orbit';
    }

    switchToWalk() {
        if (this._mode === 'walk') return;
        if (!this._walkControl) return;
        this._savedOrbitPos = this.camera.position.clone();
        this._savedOrbitTarget = this._orbitControls.target.clone();
        this._orbitControls.enabled = false;
        this._walkControl.enable();
        this._mode = 'walk';
    }

    focusOn(position) {
        if (this._walkControl) this._walkControl.disable();
        this._orbitControls.enabled = true;
        this._focusTarget = position.clone();
        this._orbitControls.target.copy(position);
        this.camera.position.set(position.x + 3, position.y + 2, position.z + 3);
        this._orbitControls.update();
        this._mode = 'focus';
    }

    update() {
        if (this._orbitControls && this._orbitControls.enabled) {
            this._orbitControls.update();
        }
        if (this._walkControl && this._mode === 'walk') {
            this._walkControl.update();
        }
    }

    reset() {
        this.switchToOrbit();
        this._orbitControls.target.set(0, 1, 0);
        this.camera.position.set(8, 6, 8);
        this._orbitControls.update();
    }

    dispose() {
        if (this._orbitControls) this._orbitControls.dispose();
        if (this._walkControl) this._walkControl.dispose();
    }
}
