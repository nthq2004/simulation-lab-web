import * as THREE from 'three';

/**
 * EngineAnimator - 柴油机活塞/曲轴运动动画驱动
 * 从 EquipmentPool 读取转速（RPM），驱动曲轴旋转和活塞往复运动
 */
export class EngineAnimator {
    /**
     * @param {THREE.Group} group  柴油机完整模型组（需含 userData.movingParts）
     * @param {Object} pool        EquipmentPool 实例
     * @param {string} devId       设备 ID
     */
    constructor(group, pool, devId = 'me-01') {
        this.parts = group.userData.movingParts;
        this.pool = pool;
        this.devId = devId;
        this._angle = 0;
    }

    /**
     * 每帧更新（由 AnimationManager 驱动）
     * @param {number} dt  帧间隔（秒）
     */
    tick(dt) {
        const dev = this.pool.get(this.devId);
        const speed = dev ? (dev.state.speed || 0) : 0;
        if (speed <= 0) return;

        // RPM → 度/秒
        const degPerSec = speed * 360 / 60;
        this._angle = (this._angle + degPerSec * dt) % 360;

        // 曲轴旋转
        if (this.parts.crankshaft) {
            this.parts.crankshaft.rotation.z = THREE.MathUtils.degToRad(this._angle);
        }

        // 4 活塞：相位 0°, 180°, 0°, 180°（发火顺序 1-3-4-2）
        const phases = [0, 180, 0, 180];
        this.parts.pistons.forEach((piston, i) => {
            if (!piston) return;
            const stroke = 0.3; // 活塞行程振幅
            const offset = Math.sin(THREE.MathUtils.degToRad(this._angle + phases[i])) * stroke;
            piston.position.y = offset;
        });
    }
}
