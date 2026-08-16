import * as THREE from 'three';

/**
 * 创建管路 3D 模型
 * @param {Object} opts
 * @param {THREE.Vector3} opts.from  起点
 * @param {THREE.Vector3} opts.to    终点
 * @param {number} opts.radius       管径
 * @param {number} opts.color        颜色
 * @returns {THREE.Mesh}
 */
export function createPipeSegment(opts = {}) {
    const from = opts.from || new THREE.Vector3(0, 0, 0);
    const to = opts.to || new THREE.Vector3(1, 0, 0);
    const radius = opts.radius || 0.04;
    const color = opts.color || 0x90a4ae;

    const direction = new THREE.Vector3().copy(to).sub(from);
    const length = direction.length();

    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
    const material = new THREE.MeshStandardMaterial({ color });
    const pipe = new THREE.Mesh(geometry, material);

    // 定位到中点并朝向终点方向
    const mid = new THREE.Vector3().copy(from).add(to).multiplyScalar(0.5);
    pipe.position.copy(mid);

    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
    pipe.quaternion.copy(quat);

    return pipe;
}

/**
 * 创建弯头 (90度)
 */
export function createPipeElbow(opts = {}) {
    const group = new THREE.Group();
    const radius = opts.radius || 0.04;
    const color = opts.color || 0x90a4ae;
    const mat = new THREE.MeshStandardMaterial({ color });

    // 简化弯头 = 一个环段 (用环形几何体近似)
    const elbow = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 2.5, radius, 6, 8, Math.PI / 2),
        mat
    );
    group.add(elbow);

    return group;
}
