import * as THREE from 'three';

/**
 * FlowParticles - 管路流体粒子动画
 * 在管路中生成流动粒子，根据对应泵的运行状态控制流速
 */
export class FlowParticles {
    /** 每段管路的粒子数 */
    static PARTICLES_PER_PIPE = 20;
    /** 粒子尺寸 */
    static PARTICLE_SIZE = 0.06;
    /** 粒子不透明度 */
    static PARTICLE_OPACITY = 0.7;
    /** 泵运行时粒子流速 */
    static SPEED_RUNNING = 0.4;
    /** 泵停止时粒子流速（停止流动） */
    static SPEED_STOPPED = 0;
    /** 未找到泵时的保底流速（缓慢流动） */
    static SPEED_NO_PUMP = 0.1;

    constructor(scene, pool) {
        this.scene = scene;
        this.pool = pool;
        this._systems = new Map(); // pipeId -> { points, tOffsets, pipeDef, geo }
    }

    /**
     * 注册一段管路粒子系统
     * @param {Object} pipeDef 管道定义，包含 id, pumpId, from, to, color
     *   from/to 为形如 [x, y, z] 的数组
     */
    registerPipe(pipeDef) {
        if (!pipeDef?.id || !pipeDef?.from || !pipeDef?.to) {
            console.warn('[FlowParticles] invalid pipeDef: missing id/from/to', pipeDef);
            return;
        }

        const count = FlowParticles.PARTICLES_PER_PIPE;
        const positions = new Float32Array(count * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: pipeDef.color,
            size: FlowParticles.PARTICLE_SIZE,
            transparent: true,
            opacity: FlowParticles.PARTICLE_OPACITY,
        });

        const points = new THREE.Points(geo, mat);

        // 初始化粒子沿管道路径均匀分布
        const tOffsets = [];
        const fx = pipeDef.from[0], fy = pipeDef.from[1], fz = pipeDef.from[2];
        const tx = pipeDef.to[0],   ty = pipeDef.to[1],   tz = pipeDef.to[2];

        for (let i = 0; i < count; i++) {
            const t = i / count;
            tOffsets.push(t);
            positions[i * 3]     = fx + (tx - fx) * t;
            positions[i * 3 + 1] = fy + (ty - fy) * t;
            positions[i * 3 + 2] = fz + (tz - fz) * t;
        }

        geo.attributes.position.needsUpdate = true;
        this.scene.add(points);
        this._systems.set(pipeDef.id, { points, tOffsets, pipeDef, geo });
    }

    /**
     * 获取粒子流速
     * @param {Object|null} pump 设备对象
     * @returns {number} 流速
     */
    _getFlowRate(pump) {
        if (!pump) return FlowParticles.SPEED_NO_PUMP;
        const speed = pump.state ? pump.state.speed : 0;
        return speed > 0 ? FlowParticles.SPEED_RUNNING : FlowParticles.SPEED_STOPPED;
    }

    /**
     * 每帧更新粒子位置
     * @param {number} dt 帧间隔（秒）
     */
    update(dt) {
        this._systems.forEach((sys) => {
            try {
                const flowRate = this._getFlowRate(this.pool.get(sys.pipeDef.pumpId));
                const pos = sys.geo.attributes.position.array;
                const fx = sys.pipeDef.from[0], fy = sys.pipeDef.from[1], fz = sys.pipeDef.from[2];
                const tx = sys.pipeDef.to[0],   ty = sys.pipeDef.to[1],   tz = sys.pipeDef.to[2];

                for (let i = 0; i < sys.tOffsets.length; i++) {
                    let t = (sys.tOffsets[i] + flowRate * dt) % 1;
                    sys.tOffsets[i] = t;
                    pos[i * 3]     = fx + (tx - fx) * t;
                    pos[i * 3 + 1] = fy + (ty - fy) * t;
                    pos[i * 3 + 2] = fz + (tz - fz) * t;
                }

                sys.geo.attributes.position.needsUpdate = true;
            } catch (e) {
                console.warn(`[FlowParticles] update error for pipe "${sys.pipeDef.id}":`, e);
            }
        });
    }

    /** 清理所有粒子系统 */
    clear() {
        this._systems.forEach((sys) => {
            try {
                this.scene.remove(sys.points);
                sys.geo.dispose();
                sys.points.material.dispose();
            } catch (e) {
                console.warn('[FlowParticles] clear error:', e);
            }
        });
        this._systems.clear();
    }
}
