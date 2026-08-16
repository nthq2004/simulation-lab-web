import * as THREE from 'three';

/**
 * 创建发电机/交流发电机 3D 模型
 * @param {Object} opts
 * @param {number} opts.color 状态颜色
 * @returns {THREE.Group}
 */
export function createGeneratorModel(opts = {}) {
    const color = opts.color || 0x90a4ae;
    const group = new THREE.Group();

    // 定子外壳
    const stator = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.8, 0.9, 16),
        new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 })
    );
    stator.position.y = 0.5;
    stator.rotation.z = Math.PI / 2;
    group.add(stator);

    // 前端盖
    const frontCover = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0x78909c })
    );
    frontCover.position.set(0.55, 0.5, 0);
    frontCover.rotation.y = Math.PI / 2;
    group.add(frontCover);

    // 后端盖
    const rearCover = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0x78909c })
    );
    rearCover.position.set(-0.55, 0.5, 0);
    rearCover.rotation.y = -Math.PI / 2;
    group.add(rearCover);

    // 接线盒
    const jbox = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.25, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x455a64 })
    );
    jbox.position.set(0, 0.9, 0.7);
    group.add(jbox);

    // 底座
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x424242 })
    );
    base.position.y = 0.05;
    group.add(base);

    // 轴伸端
    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x616161, metalness: 0.7 })
    );
    shaft.position.set(0.75, 0.5, 0);
    shaft.rotation.z = Math.PI / 2;
    group.add(shaft);

    group.userData.parts = { stator, base, jbox };

    return group;
}
