import * as THREE from 'three';

/**
 * 创建泵的 3D 模型（基础几何体组合）
 * @param {Object} opts
 * @param {number} opts.color  状态颜色，默认灰色
 * @returns {THREE.Group}
 */
export function createPumpModel(opts = {}) {
    const color = opts.color || 0x9e9e9e;
    const group = new THREE.Group();

    // 泵体
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 0.8),
        new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 0.4;
    group.add(body);

    // 电机
    const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.8, 16),
        new THREE.MeshStandardMaterial({ color: 0x607d8b })
    );
    motor.position.set(0.9, 0.4, 0);
    motor.rotation.z = Math.PI / 2;
    group.add(motor);

    // 进口法兰
    const inlet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x795548 })
    );
    inlet.position.set(-0.8, 0.4, 0);
    inlet.rotation.z = Math.PI / 2;
    group.add(inlet);

    // 出口法兰
    const outlet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x795548 })
    );
    outlet.position.set(0, 0.4, 0.6);
    outlet.rotation.x = Math.PI / 2;
    group.add(outlet);

    // 底座
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x616161 })
    );
    base.position.y = 0.05;
    group.add(base);

    group.userData.parts = { body, motor, base };

    return group;
}
