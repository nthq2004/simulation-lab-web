import * as THREE from 'three';

/**
 * 创建阀门 3D 模型
 * @param {Object} opts
 * @returns {THREE.Group}
 */
export function createValveModel(opts = {}) {
    const color = opts.color || 0x78909c;
    const group = new THREE.Group();

    // 阀体
    const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    body.scale.set(1, 0.8, 0.8);
    body.position.y = 0.15;
    group.add(body);

    // 手轮
    const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.02, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xff8f00 })
    );
    wheel.position.y = 0.35;
    group.add(wheel);

    // 阀杆
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.15, 6),
        new THREE.MeshStandardMaterial({ color: 0x616161 })
    );
    stem.position.y = 0.28;
    group.add(stem);

    // 法兰接口（两侧）
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x795548 });
    for (const x of [-0.12, 0.12]) {
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8),
            flangeMat
        );
        flange.position.set(x, 0.15, 0);
        flange.rotation.z = Math.PI / 2;
        group.add(flange);
    }

    return group;
}
