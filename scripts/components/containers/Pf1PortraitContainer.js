/**
 * PF1 肖像容器
 *
 * core 的 PortraitContainer 只负责：肖像图、肖像数据徽章、右键菜单、视频肖像。
 * 血条是适配器自己的事（每个系统对"血"的定义不一样），所以这里补：
 *   - 一条贴着肖像底部的血条
 *   - 「12 / 34 (+5)」这样的血量文字
 *   - 右键：受伤 / 治疗（直接改 system.attributes.hp.value）
 *
 * 工厂函数 + 动态 import：避免本模块在 core 还没加载完时就去拿 core 的类。
 */

import { getDamagePercent, getHealth, getHealthSegments } from '../../utils/pf1-data.js';
import { applyHpDelta, applyNonlethalDelta, rollInitiative } from '../../features/Pf1ItemUse.js';
import { applyTokenTint, getTintForHealth, syncActorTint } from '../../utils/tokenTint.js';

const MODULE_ID = 'bg3-hud-pf1';

export async function createPf1PortraitContainer() {
    const { PortraitContainer } = await import(
        '/modules/bg3-hud-core/scripts/components/containers/PortraitContainer.js'
        );

    return class Pf1PortraitContainer extends PortraitContainer {
        /** @type {HTMLElement|null} 血条填充层 */
        _hpFill = null;
        /** @type {HTMLElement|null} 血条本体 */
        _hpBar = null;
        /** @type {HTMLElement|null} 瘀伤条 */
        _hpNonlethal = null;
        /** @type {HTMLElement|null} 红/紫/白那一行文字 */
        _hpLine = null;

        /**
         * 渲染：先让 core 把肖像搭好，再把自己的血条插进去
         *
         * 注意 core 的 render() 在切 token / 换肖像时会重建内部 DOM，
         * 所以不能只在"第一次"插血条——每次渲染都检查一下血条还在不在。
         * @returns {Promise<HTMLElement>}
         */
        async render() {
            await super.render();
            // 受伤红色蒙层要在血条下面，所以先建
            if (!this.element?.querySelector('.pf1-health-overlay')) {
                this._buildDamageOverlay();
            }
            if (!this.element?.querySelector('.pf1-hp-wrap')) {
                this._buildHealthBar();
            }
            this.updateHealth();
            return this.element;
        }

        /**
         * 受伤蒙层：半透明红色从肖像底部按受伤比例往上涨
         *
         * ★ 必须用 core 的 `.health-overlay > .damage-overlay` 结构：
         *   core 会给 `.portrait-image-subcontainer` 套 `mask-image: url(肖像)`，
         *   红色只保留"肖像本身不透明的部分"，所以不会出现环绕肖像的红圈，
         *   也不会被肖像图片盖住（网格顺序上它在 img 之后）。
         * @private
         */
        _buildDamageOverlay() {
            const sub =
                this.element?.querySelector('.portrait-image-subcontainer') ??
                this.element?.querySelector('.portrait-image-container') ??
                this.element;
            if (!sub) return;

            const overlay = this.createElement('div', ['health-overlay', 'pf1-health-overlay']);
            const fill = this.createElement('div', ['damage-overlay', 'pf1-damage-fill']);
            overlay.appendChild(fill);

            // 插在 img/video 之后：盖在肖像上，但不挡点击
            const media = sub.querySelector('.portrait-image, .portrait-video');
            if (media?.parentElement === sub) {
                media.after(overlay);
            } else {
                sub.appendChild(overlay);
            }

            this._damageLayer = overlay;
            this._damageFill = fill;

            // core 的遮罩只在"渲染时已经存在 overlay"才会绑，所以这里主动补一次
            try {
                this._syncPortraitAlphaMask?.(sub);
            } catch {
                /* 没有这个方法就算了，至少还能靠 CSS 兜住 */
            }
        }

        /**
         * 血量（core 在更新时会调 getHealth 拿数值）
         * @returns {{current:number, max:number, percent:number, damage:number, temp:number}}
         */
        getHealth() {
            const hp = getHealth(this.actor);
            return {
                current: hp.value,
                max: hp.max,
                percent: hp.percent,
                damage: 100 - hp.percent,
                temp: hp.temp
            };
        }

        /**
         * 造血条 DOM
         * @private
         */
        _buildHealthBar() {
            const host = this.element?.querySelector('.portrait-image-container') ?? this.element;
            if (!host) return;

            const showOverlay = game.settings.get('bg3-hud-pf1', 'showHealthOverlay') ?? true;

            const wrap = this.createElement('div', ['pf1-hp-wrap']);
            if (!showOverlay) wrap.classList.add('no-overlay');

            const bar = this.createElement('div', ['pf1-hp-bar']);
            const fill = this.createElement('div', ['pf1-hp-fill']);
            bar.appendChild(fill);

            // 瘀伤：从右往左盖一层紫条（画在血条里面，占最大血量的比例）
            const nonlethalFill = this.createElement('div', ['pf1-hp-nonlethal']);
            bar.appendChild(nonlethalFill);

            // 一行文字：剩余/最大（红）· 瘀伤（紫）· 虚假生命（白）
            const line = this.createElement('div', ['pf1-hp-line']);
            line.setAttribute('role', 'status');

            wrap.appendChild(bar);
            wrap.appendChild(line);
            host.appendChild(wrap);

            this._hpFill = fill;
            this._hpBar = bar;
            this._hpNonlethal = nonlethalFill;
            this._hpLine = line;

            // 血条点击：打开受伤/治疗对话框（点数字也一样）
            const onHpClick = async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this._promptHpChange();
            };
            this.addEventListener(bar, 'click', onHpClick);
            this.addEventListener(line, 'click', onHpClick);
        }

        /**
         * 只更新数值，不重建 DOM（每次 actor 数据变化都会走这里，重建会闪）
         */
        updateHealth() {
            if (!this._hpFill) return;
            const hp = getHealth(this.actor);

            this._hpFill.style.width = `${hp.percent}%`;
            this._hpBar?.setAttribute('data-level', this._severity(hp.ratio));

            // 受伤蒙层：半透明红色从肖像底部按受伤比例往上涨（32/59 → 46% 高）
            if (this._damageFill) {
                const damage = getDamagePercent(hp);
                const enabled = this._isDamageOverlayEnabled();
                this._damageFill.style.height = enabled ? `${damage}%` : '0%';
                this._damageFill.style.opacity = damage > 0 ? '1' : '0';
                this._damageLayer?.classList.toggle('pf1-damage-off', !enabled);
                // 伤势越重，红得越浓
                this._damageFill.setAttribute('data-level', this._severity(hp.ratio));
                // 换了肖像（图片 src 变了）时 core 会重置 mask，这里补一次
                const sub = this.element?.querySelector('.portrait-image-subcontainer');
                if (sub && !sub.hasAttribute('data-bend-mode')) {
                    try {
                        this._syncPortraitAlphaMask?.(sub);
                    } catch {
                        /* ignore */
                    }
                }
            }

            // 瘀伤条：占最大血量的比例
            if (this._hpNonlethal) {
                const nlPercent = Math.min(100, Math.round((hp.nonlethal / hp.max) * 100));
                this._hpNonlethal.style.width = hp.nonlethal > 0 ? `${nlPercent}%` : '0%';
                this._hpNonlethal.style.display = hp.nonlethal > 0 ? '' : 'none';
            }

            // 文字行：每次重建（最多 3 段，开销可以忽略，省掉一堆显隐判断）
            if (this._hpLine) {
                const segments = getHealthSegments(hp);
                this._hpLine.textContent = '';
                for (const segment of segments) {
                    const span = this.createElement('span', [segment.cls]);
                    span.textContent = segment.text;
                    span.setAttribute('data-tooltip', segment.title);
                    this._hpLine.appendChild(span);
                }
            }

            // 悬停看完整数值
            const parts = [`${hp.value} / ${hp.max}`];
            if (hp.temp > 0) parts.push(`虚假生命 +${hp.temp}`);
            if (hp.nonlethal > 0) parts.push(`瘀伤 ${hp.nonlethal}`);
            const hpWrap = this.element?.querySelector('.pf1-hp-wrap');
            if (hpWrap) hpWrap.setAttribute('data-tooltip', `点击调整生命值｜${parts.join('｜')}`);

            // token 染色跟着血量走
            void this._syncTokenTint();
        }

        /**
         * 按血量给 token 染色（BG3 网页里就是 token 本身变色）
         *
         * 实际逻辑在 utils/tokenTint.js，那边也会被 updateActor / createToken 钩子用，
         * 所以就算 HUD 没开在这个 token 上，也会跟着血量变色。
         * @private
         */
        async _syncTokenTint() {
            try {
                await syncActorTint(this.actor, this.token);
            } catch (error) {
                // 染色只是装饰：坏了也不能影响血条，但要说一次原因
                if (!this._tintWarned) {
                    this._tintWarned = true;
                    console.warn(`${MODULE_ID} | 给 token 染色失败（血条不受影响）`, error);
                }
            }
        }

        /**
         * 给单个 token 上色 / 还原（转调 util，保留这个方法方便测试）
         * @param {Token} token
         * @param {string} tint 空字符串表示还原
         * @private
         */
        async _applyTokenTint(token, tint) {
            await applyTokenTint(token, tint);
        }

        /**
         * 血量 → 颜色
         * @param {{ratio:number, value:number, nonlethal?:number}} hp
         * @returns {string} 空字符串表示不染色
         * @private
         */
        _tintForHealth(hp) {
            return getTintForHealth(hp);
        }

        /**
         * 受伤蒙层开关（设置里可关）
         * @returns {boolean}
         * @private
         */
        _isDamageOverlayEnabled() {
            try {
                return game.settings.get(MODULE_ID, 'portraitDamageOverlay') !== false;
            } catch {
                return true;
            }
        }

        /** 血量分档，给 CSS 用 */
        _severity(ratio) {
            if (ratio <= 0.25) return 'critical';
            if (ratio <= 0.5) return 'low';
            if (ratio <= 0.75) return 'medium';
            return 'full';
        }

        /**
         * 受伤 / 治疗 / 瘀伤 对话框
         * 优先用 v13 的 DialogV2，老环境退回 Dialog
         * @private
         */
        async _promptHpChange() {
            const hp = getHealth(this.actor);
            const title = `调整生命值 —— ${this.actor?.name ?? ''}`;
            const content = `
                <form class="pf1-hp-dialog">
                    <p>当前：<strong>${hp.value} / ${hp.max}</strong>${hp.temp ? `（临时 +${hp.temp}）` : ''}${
                        hp.nonlethal > 0 ? `（瘀伤 ${hp.nonlethal}）` : ''
                    }</p>
                    <div class="form-group">
                        <label>生命值（正数=治疗，负数=受伤）</label>
                        <input type="number" name="deltaHp" value="0" autofocus />
                    </div>
                    <div class="form-group">
                        <label>瘀伤（正数=增加非致命伤害）</label>
                        <input type="number" name="deltaNl" value="0" />
                    </div>
                </form>`;

            const apply = async (result) => {
                const deltaHp = Number(result?.deltaHp) || 0;
                const deltaNl = Number(result?.deltaNl) || 0;
                if (deltaHp) await applyHpDelta(this.actor, deltaHp);
                if (deltaNl) await applyNonlethalDelta(this.actor, deltaNl);
            };

            const DialogV2 = foundry.applications?.api?.DialogV2;
            if (DialogV2?.prompt) {
                const result = await DialogV2.prompt({
                    window: { title },
                    content,
                    ok: {
                        label: '应用',
                        callback: (event, button) => ({
                            deltaHp: button.form.elements.deltaHp?.value,
                            deltaNl: button.form.elements.deltaNl?.value
                        })
                    },
                    modal: false,
                    rejectClose: false
                });
                await apply(result);
                return;
            }

            // 老版本兜底
            const dialog = new Dialog({
                title,
                content,
                buttons: {
                    apply: {
                        label: '应用',
                        callback: async (html) => {
                            const form =
                                html?.querySelector?.('form.pf1-hp-dialog') ??
                                html?.[0]?.querySelector?.('form.pf1-hp-dialog');
                            const valueOf = (name) =>
                                Number(
                                    html?.find?.(`input[name="${name}"]`)?.val?.() ??
                                        form?.querySelector?.(`input[name="${name}"]`)?.value ??
                                        0
                                ) || 0;
                            await apply({ deltaHp: valueOf('deltaHp'), deltaNl: valueOf('deltaNl') });
                        }
                    },
                    cancel: { label: '取消' }
                },
                default: 'apply'
            });
            dialog.render(true);
        }

        /**
         * 右键菜单：core 的默认菜单什么都不做，这里补上"投先攻"和"打开角色卡"
         * @returns {Array<Object>}
         * @private
         */
        _getCorePortraitMenuItems() {
            return [
                {
                    label: '打开角色卡',
                    icon: 'fas fa-address-card',
                    onClick: () => this.actor?.sheet?.render(true)
                },
                {
                    label: '投先攻',
                    icon: 'fas fa-bolt',
                    onClick: () => rollInitiative(this.actor, null, this.token)
                },
                {
                    label: '调整生命值',
                    icon: 'fas fa-heart-pulse',
                    onClick: () => this._promptHpChange()
                }
            ];
        }

        /**
         * 切换 token 时 core 会调这里；血条数值跟着换人
         */
        async swapTokenContext(actor, token) {
            const result = await super.swapTokenContext(actor, token);
            this.updateHealth();
            return result;
        }
    };
}
