import * as THREE from 'three';

/**
 * 创建板式换热器 3D 模型
 * @param {Object} opts
 * @returns {THREE.Group}
 */
export function createHeatExchangerModel(opts = {}) {
    const color = opts.color || 0x607d8b;
    const group = new THREE.Group();

    // 换热器主体（长方形板组）
    const plates = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.2, 0.5),
        new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 })
    );
    plates.position.y = 0.6;
    group.add(plates);

    // 板片纹理（条纹效果）
    for (let i = -4; i <= 4; i++) {
        const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.9, 0.4),
            new THREE.MeshStandardMaterial({ color: 0x455a64 })
        );
        strip.position.set(i * 0.1, 0.6, 0);
        group.add(strip);
    }

    // 四接口法兰
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x795548 });
    const positions = [
        [-0.4, 1.0, 0.3],  // 淡水进口
        [0.4, 1.0, 0.3],   // 淡水出口
        [-0.4, 0.2, 0.3],  // 海水进口
        [0.4, 0.2, 0.3],   // 海水出口
    ];
    positions.forEach(pos => {
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 0.15, 8),
            flangeMat
        );
        flange.position.set(pos[0], pos[1], pos[2]);
        flange.rotation.x = Math.PI / 2;
        group.add(flange);
    });

    // 框架
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.05, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x37474f })
    );
    frame.position.y = 0.05;
    group.add(frame);

    return group;
}
