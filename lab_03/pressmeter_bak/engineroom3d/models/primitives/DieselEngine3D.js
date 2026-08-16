import * as THREE from 'three';

/**
 * 创建柴油机 3D 模型（直列 4 缸基础几何体组合）
 * @param {Object} opts
 * @param {number} opts.color 状态颜色
 * @returns {THREE.Group}
 */
export function createDieselEngineModel(opts = {}) {
    const color = opts.color || 0x78909c;
    const group = new THREE.Group();

    // 机体（长方体）
    const block = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 1.2, 1.0),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.3 })
    );
    block.position.y = 0.6;
    group.add(block);

    // 气缸盖（顶部）
    const head = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.15, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x546e7a })
    );
    head.position.set(0, 1.28, 0);
    group.add(head);

    // 排烟管
    const exhaustPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x37474f })
    );
    exhaustPipe.position.set(0, 1.5, 0.5);
    exhaustPipe.rotation.x = Math.PI / 2;
    group.add(exhaustPipe);

    // 增压器（圆柱+锥体）
    const turboBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: 0x607d8b })
    );
    turboBody.position.set(1.6, 1.5, 0);
    group.add(turboBody);

    // 飞轮（圆盘）
    const flywheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 0.15, 16),
        new THREE.MeshStandardMaterial({ color: 0x616161, metalness: 0.6, roughness: 0.4 })
    );
    flywheel.position.set(-1.6, 0.6, 0);
    flywheel.rotation.z = Math.PI / 2;
    group.add(flywheel);

    // 底座
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.1, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x424242 })
    );
    base.position.y = 0.05;
    group.add(base);

    // 曲轴箱（底部凸起）
    const crankCase = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.3, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x455a64 })
    );
    crankCase.position.y = 0.25;
    group.add(crankCase);

    group.userData.parts = { block, flywheel, turboBody };

    // ── 运动部件（活塞/曲轴动画） ──
    const movingParts = new THREE.Group();
    movingParts.name = 'movingParts';
    movingParts.position.y = 0.6; // 与机体中心对齐
    group.add(movingParts);

    // 曲轴枢轴组（由 EngineAnimator 驱动旋转）
    const crankshaftPivot = new THREE.Group();
    crankshaftPivot.name = 'crankshaftPivot';
    movingParts.add(crankshaftPivot);

    // 曲轴（沿 X 轴方向的细长圆柱）
    const crankshaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x616161, metalness: 0.5, roughness: 0.4 })
    );
    crankshaft.rotation.z = Math.PI / 2; // 对齐到 X 轴
    crankshaftPivot.add(crankshaft);

    // 4 个活塞（直列四缸，相位对 0°/180°/0°/180°）
    // X 轴位置：从 -1.2 到 1.2 等距分布
    const pistonXPositions = [-1.2, -0.4, 0.4, 1.2];
    const pistons = pistonXPositions.map(x => {
        const piston = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.12, 0.25, 8),
            new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.6 })
        );
        piston.position.set(x, 0, 0);
        movingParts.add(piston); // not crankshaftPivot — pistons move linearly, not rotationally
        return piston;
    });

    group.userData.movingParts = {
        crankshaft: crankshaftPivot, // 枢轴组引用（供 EngineAnimator 旋转）
        pistons: pistons,            // 4 个活塞网格
    };

    return group;
}
