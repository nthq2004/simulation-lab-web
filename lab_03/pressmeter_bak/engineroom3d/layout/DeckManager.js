import * as THREE from 'three';

/**
 * DeckManager - 机舱甲板布局管理
 * 支持多层甲板、地板、舱壁
 */
export class DeckManager {
    constructor(scene) {
        this.scene = scene;
        this.decks = [];
    }

    /**
     * 创建一层甲板
     * @param {number} y        高度
     * @param {number} width    宽度
     * @param {number} depth    深度
     * @param {Object} opts
     */
    addDeck(y, width, depth, opts = {}) {
        const mat = new THREE.MeshStandardMaterial({
            color: opts.color || 0x37474f,
            roughness: 0.8,
            metalness: 0.2,
        });
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
        deck.rotation.x = -Math.PI / 2;
        deck.position.set(0, y, 0);
        deck.receiveShadow = true;
        this.scene.add(deck);

        this.decks.push({ y, width, depth, mesh: deck });
        return deck;
    }

    /**
     * 创建舱壁
     */
    addWall(x, y, z, width, height, depth, opts = {}) {
        const mat = new THREE.MeshStandardMaterial({
            color: opts.color || 0x455a64,
            roughness: 0.9,
            metalness: 0.1,
            transparent: true,
            opacity: opts.opacity || 0.3,
        });
        const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
        wall.position.set(x, y, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.scene.add(wall);
        return wall;
    }
}
