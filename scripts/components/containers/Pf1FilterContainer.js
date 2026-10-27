/**
 * PF1 过滤器
 *
 * core 的过滤器只有两种能力：
 *   1) 显示一排按钮（getFilters 返回定义数组）
 *   2) 判断某个格子是否命中（matchesFilter(filter, cell)）
 *
 * 关键点：matchesFilter 收到的 `cell` 是 **DOM 元素**，不是数据对象，
 * 所以判断只能靠 dataset —— 这就是适配器里 decorateCellElement 必须写 dataset 的原因。
 *
 * PF1 的过滤维度：
 *   - 物品类型（武器 / 法术 / 专长 / 增益 / 消耗品 / 装备）
 *   - 法术环位（只列角色实际有的环位）
 */

export async function createPf1FilterContainer() {
    const { FilterContainer } = await import(
        '/modules/bg3-hud-core/scripts/components/containers/FilterContainer.js'
        );

    return class Pf1FilterContainer extends FilterContainer {
        constructor(options = {}) {
            super({
                ...options,
                getFilters: () => this.getPf1Filters()
            });
        }

        /**
         * 过滤按钮定义
         * @returns {Array<Object>}
         */
        getPf1Filters() {
            if (!this.actor) return [];

            const filters = [];
            const L = (key, fallback) => {
                const text = game.i18n?.localize?.(`bg3-hud-pf1.Filters.${key}`);
                return text && text !== `bg3-hud-pf1.Filters.${key}` ? text : fallback;
            };

            const items = this.actor.items?.contents ?? [];

            /* ── 按类型 ─────────────────────────────────── */
            const types = [
                { id: 'weapon', label: L('Weapon', '武器'), symbol: 'fa-sword', color: '#e74c3c' },
                { id: 'spell', label: L('Spell', '法术'), symbol: 'fa-wand-magic-sparkles', color: '#9b59b6' },
                { id: 'feat', label: L('Feat', '专长'), symbol: 'fa-star', color: '#f39c12' },
                { id: 'buff', label: L('Buff', '增益'), symbol: 'fa-shield-heart', color: '#2ecc71' },
                { id: 'consumable', label: L('Consumable', '消耗品'), symbol: 'fa-flask', color: '#1abc9c' },
                { id: 'equipment', label: L('Equipment', '装备'), symbol: 'fa-shirt', color: '#3498db' }
            ];

            // 只在角色身上真的有这类物品时才显示按钮，避免一排永远点不出东西的按钮
            const present = new Set(items.map((i) => i.type));
            for (const type of types) {
                if (!present.has(type.id)) continue;
                filters.push({
                    id: `type-${type.id}`,
                    label: type.label,
                    symbol: type.symbol,
                    classes: ['item-type-button'],
                    color: type.color,
                    data: { itemType: type.id }
                });
            }

            /* ── 按特性子类型（PF1 全存成 feat，靠 subType 区分）──── */
            const subTypes = [
                { id: 'classFeat', label: L('ClassFeature', '职业特性'), symbol: 'fa-sitemap', color: '#d35400' },
                { id: 'racial', label: L('RacialTrait', '种族特性'), symbol: 'fa-dna', color: '#16a085' },
                { id: 'trait', label: L('Trait', '背景特性'), symbol: 'fa-scroll', color: '#7f8c8d' }
            ];
            const presentSubTypes = new Set(
                items.filter((i) => i.type === 'feat').map((i) => i.system?.subType ?? 'feat')
            );
            for (const sub of subTypes) {
                if (!presentSubTypes.has(sub.id)) continue;
                filters.push({
                    id: `subtype-${sub.id}`,
                    label: sub.label,
                    symbol: sub.symbol,
                    classes: ['item-subtype-button'],
                    color: sub.color,
                    data: { itemType: 'feat', subType: sub.id }
                });
            }

            /* ── 按法术环位 ─────────────────────────────── */
            const levels = new Set();
            for (const item of items) {
                if (item.type !== 'spell') continue;
                const lvl = Number(item.system?.level);
                if (Number.isFinite(lvl)) levels.add(lvl);
            }
            for (const lvl of [...levels].sort((a, b) => a - b)) {
                filters.push({
                    id: `spell-level-${lvl}`,
                    label: lvl === 0 ? L('Cantrip', '戏法') : `${lvl} ${L('Ring', '环')}`,
                    short: String(lvl),
                    classes: ['spell-level-button'],
                    color: '#8e44ad',
                    data: { spellLevel: lvl }
                });
            }

            return filters;
        }

        /**
         * 某个格子是否命中过滤器
         * @param {Object} filter 过滤定义（含 .data）
         * @param {HTMLElement} cell 格子 DOM
         * @returns {boolean}
         */
        matchesFilter(filter, cell) {
            if (!filter?.data || !cell?.dataset) return false;
            const data = filter.data;

            // 子类型优先：特性按钮同时限制了 itemType=feat
            if (data.subType) {
                if (data.itemType && cell.dataset.itemType !== data.itemType) return false;
                return cell.dataset.subType === data.subType;
            }

            if (data.spellLevel !== undefined) {
                if (cell.dataset.itemType !== 'spell') return false;
                return Number(cell.dataset.level) === Number(data.spellLevel);
            }

            if (data.itemType) {
                return cell.dataset.itemType === data.itemType;
            }

            return false;
        }
    };
}
