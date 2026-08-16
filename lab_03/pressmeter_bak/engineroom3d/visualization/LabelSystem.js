import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * LabelSystem - 3D 设备悬浮标签
 * 使用 CSS2DRenderer + 独立标签场景，避免遍历主场景
 */
export class LabelSystem {
    constructor() {
        this._labels = new Map();
        this._enabled = true;
        this._renderer = null;
        this._labelScene = new THREE.Scene();
    }

    init(container) {
        this._renderer = new CSS2DRenderer();
        this._renderer.setSize(container.clientWidth, container.clientHeight);
        this._renderer.domElement.style.position = 'absolute';
        this._renderer.domElement.style.top = '0';
        this._renderer.domElement.style.left = '0';
        this._renderer.domElement.style.pointerEvents = 'none';
        container.appendChild(this._renderer.domElement);
    }

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
        // 添加到独立标签场景（CSS2DRenderer 只遍历标签对象，不遍历主场景）
        this._labelScene.add(labelObj);
    }

    updateLabel(devId, text) {
        const label = this._labels.get(devId);
        if (label) {
            label.element.textContent = text;
        }
    }

    updatePosition(devId, position) {
        const label = this._labels.get(devId);
        if (label) {
            label.position.copy(position);
        }
    }

    setVisible(visible) {
        this._enabled = visible;
        this._labels.forEach(label => {
            label.element.style.display = visible ? '' : 'none';
        });
    }

    toggle() {
        this.setVisible(!this._enabled);
    }

    render(camera) {
        if (this._renderer) {
            // 使用独立标签场景，避免遍历主场景中大量非标签对象
            this._renderer.render(this._labelScene, camera);
        }
    }

    /** 更新标签场景矩阵（主场景矩阵变化后调用） */
    updateMatrix() {
        this._labelScene.updateMatrixWorld(true);
    }

    resize(width, height) {
        if (this._renderer) {
            this._renderer.setSize(width, height);
        }
    }

    dispose() {
        if (this._labelScene) {
            this._labelScene.traverse(child => {
                if (child.isCSS2DObject && child.parent) {
                    child.parent.remove(child);
                }
            });
        }
        this._labels.clear();
        if (this._renderer && this._renderer.domElement && this._renderer.domElement.parentNode) {
            this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
        }
        this._renderer = null;
        this._labelScene = null;
    }
}
