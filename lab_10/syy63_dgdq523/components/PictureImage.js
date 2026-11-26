import { BaseComponent } from './BaseComponent.js';

/**
 * PictureImage - 纯图片展示组件
 *
 * 仅加载并显示一张图片，无可交互元素、无电气端口。
 * 通过 src 配置项指定图片路径（相对于 index.html 所在目录）。
 * width/height 为 0 时按图片原始尺寸显示；否则等比缩放。
 *
 * 注意：本组件不使用 Canvas 缓存。图片异步加载，若在组件隐藏状态下
 * 缓存静态组，Konva 会把不可见内容缓存为空白位图，导致显示后无图。
 */
export class PictureImage extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.type = 'picture';

        this.src = (config && config.src) || '';
        this.imgW = config && config.width ? config.width : 0;
        this.imgH = config && config.height ? config.height : 0;

        this._init();

        this.config = { src: this.src, width: this.imgW };
    }

    _init() {
        this._imgNode = new Konva.Image({
            x: 0,
            y: 0,
            image: undefined,
        });
        this._staticGroup.add(this._imgNode);
        this._loadImage();
    }

    _loadImage() {
        if (!this.src) return;
        const img = new window.Image();
        img.onload = () => {
            if (this._imgNode) {
                if (this.imgW > 0 && this.imgH > 0) {
                    const s = Math.min(this.imgW / img.width, this.imgH / img.height);
                    this._imgNode.width(img.width * s);
                    this._imgNode.height(img.height * s);
                } else if (this.imgW > 0) {
                    const s = this.imgW / img.width;
                    this._imgNode.width(this.imgW);
                    this._imgNode.height(img.height * s);
                } else {
                    this._imgNode.width(img.width);
                    this._imgNode.height(img.height);
                }
                this._imgNode.image(img);
                this.width = this._imgNode.width();
                this.height = this._imgNode.height();
                if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
                else this.sys.layer.draw();
            }
        };
        img.src = this.src;
    }

    getConfigFields() {
        return [
            { label: '图片路径', key: 'src', type: 'text' },
            { label: '显示宽度', key: 'width', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.src !== undefined && cfg.src !== this.src) {
            this.src = cfg.src;
            this._loadImage();
        }
        if (cfg.width) this.imgW = cfg.width;
    }
}
