import * as THREE from 'three';

/**
 * 创建空气瓶 3D 模型
 * @param {Object} opts
 * @returns {THREE.Group}
 */
export function createAirBottleModel(opts = {}) {
    const color = opts.color || 0x4db6ac;
    const group = new THREE.Group();

    // 瓶体（长圆柱 + 半球端）
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 1.2, 12),
        new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 })
    );
    body.position.y = 0.6;
    group.add(body);

    // 上端半球封头
    const topCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color })
    );
    topCap.position.y = 1.2;
    group.add(topCap);

    // 下端半球封头
    const bottomCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color })
    );
    bottomCap.position.y = 0;
    bottomCap.rotation.z = Math.PI;
    group.add(bottomCap);

    // 阀门
    const valve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6),
        new THREE.MeshStandardMaterial({ color: 0xff8f00 })
    );
    valve.position.y = 1.3;
    group.add(valve);

    // 底座
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.4, 0.05, 8),
        new THREE.MeshStandardMaterial({ color: 0x616161 })
    );
    base.position.y = 0.025;
    group.add(base);

    return group;
}
