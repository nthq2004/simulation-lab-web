/**
 * AnimationManager - 3D 动画帧管理器
 * 所有动画注册器统一注册到此管理器，由 EngineRoom3D 的渲染循环驱动
 */
export class AnimationManager {
    constructor() {
        this._animators = new Map(); // id → { tick(dt) }
    }

    register(id, animator) {
        if (this._animators.has(id)) {
            console.warn(`AnimationManager: animator "${id}" is being overwritten`);
        }
        this._animators.set(id, animator);
    }

    unregister(id) {
        this._animators.delete(id);
    }

    update(dt) {
        this._animators.forEach((anim, id) => {
            try { anim.tick(dt); }
            catch (e) { console.warn(`AnimationManager: animator "${id}" tick error:`, e); }
        });
    }
}
