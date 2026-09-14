/**
 * <author-avatar> — 可复用作者头像组件（零依赖原生 Web Component）
 *
 * 从 liveinpassion.me 抽取，样式与行为自包含（Shadow DOM），可直接用于任意项目。
 *
 * 用法：
 *   <author-avatar src="avatar/1.jpg" alt="Author"></author-avatar>
 *
 *   <!-- 多图轮播（每 5s 随机切换，新图加载完成后再淡出旧图，避免重叠） -->
 *   <author-avatar images="1.jpg,2.jpg,3.jpg" interval="5000" alt="Author"></author-avatar>
 *
 *   <!-- 作为链接 -->
 *   <author-avatar src="me.jpg" href="https://example.com" target="_blank"></author-avatar>
 *
 * 可覆盖的 CSS 变量：
 *   --author-avatar-size        尺寸（默认 64px，移动端可在外部媒体查询中覆盖）
 *   --author-avatar-border      边框颜色
 *   --author-avatar-border-hover 悬停边框颜色
 *   --author-avatar-radius      圆角（默认 0，即方形）
 *
 * 属性：src, alt, images(逗号分隔), interval(ms), href, target, size, random("false" 时顺序切换)
 */
class AuthorAvatar extends HTMLElement {
    static get observedAttributes() {
        return ['src', 'alt', 'images', 'interval', 'href', 'target', 'size', 'random'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    --author-avatar-size: 64px;
                    --author-avatar-border: rgba(0, 0, 0, 0.15);
                    --author-avatar-border-hover: currentColor;
                    --author-avatar-radius: 0;
                    display: inline-block;
                    width: var(--author-avatar-size);
                    height: var(--author-avatar-size);
                }
                .author-avatar {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    border: 2px solid var(--author-avatar-border);
                    border-radius: var(--author-avatar-radius);
                    box-sizing: border-box;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    background: rgba(0, 0, 0, 0.06);
                    transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
                    -webkit-tap-highlight-color: transparent;
                    -webkit-touch-callout: none;
                    -webkit-user-select: none;
                    user-select: none;
                    outline: none;
                    touch-action: manipulation;
                }
                :host([href]) .author-avatar { cursor: pointer; }
                :host([href]:focus-visible) .author-avatar {
                    border-color: var(--author-avatar-border-hover);
                }
                :host([href]:hover) .author-avatar {
                    transform: translateY(-4px);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
                    border-color: var(--author-avatar-border-hover);
                }
                img {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    opacity: 0;
                    transition: opacity 0.45s ease;
                }
                img.active { opacity: 1; }
            </style>
            <div class="author-avatar" part="box">
                <slot></slot>
            </div>`;

        this._box = this.shadowRoot.querySelector('.author-avatar');
        this._timer = null;
        this._lastIndex = -1;
        this._activeImg = null;
    }

    connectedCallback() {
            if (this.hasAttribute('size')) this._syncSize();
            if (this.hasAttribute('href')) {
                this._box.setAttribute('role', 'link');
                this._box.tabIndex = 0;
            }
        this._box.addEventListener('click', this._onClick);
        this._box.addEventListener('keydown', this._onKeyDown);
        this.addEventListener('mouseenter', this._pause);
        this.addEventListener('mouseleave', this._resume);
        this._render();
    }

    disconnectedCallback() {
        this._box.removeEventListener('click', this._onClick);
        this._box.removeEventListener('keydown', this._onKeyDown);
        this.removeEventListener('mouseenter', this._pause);
        this.removeEventListener('mouseleave', this._resume);
        this._clearTimer();
    }

    attributeChangedCallback(name) {
        if (!this.isConnected) return;
        if (name === 'size') {
            this._syncSize();
        } else {
            this._render();
        }
    }

    _syncSize() {
        const v = this.getAttribute('size') || '64px';
        this.style.setProperty('--author-avatar-size', /^\d+$/.test(v) ? v + 'px' : v);
    }

    _onClick = () => {
        const href = this.getAttribute('href');
        if (!href) return;
        const target = this.getAttribute('target');
        if (target) window.open(href, target, 'noopener,noreferrer');
        else window.location.href = href;
    };

    _onKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._box.click();
        }
    };

    _getImages() {
        const list = (this.getAttribute('images') || '').split(',').map(s => s.trim()).filter(Boolean);
        if (list.length) return list;
        const single = this.getAttribute('src');
        return single ? [single] : [];
    }

    _render() {
        this._clearTimer();
        this._box.querySelectorAll('img').forEach(img => img.remove());
        this._activeImg = null;
        this._lastIndex = -1;

        const images = this._getImages();
        if (!images.length) return;

        const alt = this.getAttribute('alt') || '';
        const first = this._createImg(images[0], alt);
        this._box.appendChild(first);
        this._show(first);

        if (images.length > 1 && this.hasAttribute('interval')) {
            this._images = images;
            this._startTimer();
        }
    }

    _createImg(src, alt) {
        const img = document.createElement('img');
        img.decoding = 'async';
        img.alt = alt;
        img.src = src;
        return img;
    }

    /** 顺序淡入淡出：先等新图加载，再淡出旧图，杜绝重叠 */
    _show(img) {
        const reveal = () => {
            if (this._activeImg && this._activeImg !== img) {
                const old = this._activeImg;
                old.classList.remove('active');
                old.addEventListener('transitionend', () => old.remove(), { once: true });
            }
            img.classList.add('active');
            this._activeImg = img;
        };
        img.complete ? reveal() : img.addEventListener('load', reveal, { once: true });
    }

    _pickNext() {
        const images = this._images;
        const random = this.getAttribute('random') !== 'false';
        let idx;
        if (random && images.length > 1) {
            do { idx = Math.floor(Math.random() * images.length); }
            while (idx === this._lastIndex);
        } else {
            idx = (this._lastIndex + 1) % images.length;
        }
        this._lastIndex = idx;

        const img = this._createImg(images[idx], this.getAttribute('alt') || '');
        this._box.appendChild(img);
        this._show(img);
    }

    _startTimer() {
        const interval = Math.max(1000, parseInt(this.getAttribute('interval'), 10) || 5000);
        this._timer = setInterval(() => this._pickNext(), interval);
    }

    _clearTimer() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }

    _pause = () => this._clearTimer();

    _resume = () => {
        if (this._images && this._images.length > 1 && this.hasAttribute('interval') && !this._timer) {
            this._startTimer();
        }
    };
}

customElements.define('author-avatar', AuthorAvatar);
