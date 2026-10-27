/**
 * PF1 自动填充
 *
 * 继承 core 的 AutoPopulateFramework：格子状态、持久化、去重、排序都归框架管，
 * 这里只回答两个问题——
 *   1) 让 GM 选的时候能选哪些"类型"（getItemTypeChoices）
 *   2) 这个角色身上哪些物品属于这些类型（getMatchingItems）
 *
 * PF1 的 item.type 集合（v11）：
 *   attack / buff / class / consumable / container / equipment / feat /
 *   implant / loot / race / spell / weapon
 */

import { loadCoreClass } from '../utils/coreBridge.js';
import { getItemUses, hasStock, isSpellDepleted } from '../utils/pf1-data.js';

const MODULE_ID = 'bg3-hud-pf1';

// 顶层 await：core 的内部文件改名时，只降级自动填充，不会让整个模块加载失败
const AutoPopulateFramework = await loadCoreClass('AutoPopulateFramework');

/** 永远不进热键栏的类型（角色构建数据、纯背景物品） */
const NEVER_POPULATE = new Set(['class', 'race', 'loot', 'container', 'kit', 'material', 'implant']);

export class Pf1AutoPopulate extends AutoPopulateFramework {
    /**
     * 当前自动填充配置（core 的配置对话框会读这个当初始值）
     * @returns {Promise<Object>}
     */
    async getAutoPopulateSettings() {
        const stored = game.settings.get(MODULE_ID, 'autoPopulateConfiguration');
        if (stored && typeof stored === 'object') return foundry.utils.deepClone(stored);
        return { grid0: [], grid1: [], grid2: [], options: {} };
    }

    /**
     * 覆盖 core 的选物品类型对话框，只为了把标题/说明换成中文
     * （core 里这两个字符串是写死的英文，没有走 i18n）
     * @param {Array<{value:string,label:string}>} choices
     * @returns {Promise<Array<string>>}
     */
    async showSelectionDialog(choices) {
        const { showPillSelectionDialog } = await import('/modules/bg3-hud-core/scripts/utils/dialogs.js');
        const result = await showPillSelectionDialog({
            title: game.i18n.localize(`${MODULE_ID}.AutoPopulate.DialogTitle`),
            description: game.i18n.localize(`${MODULE_ID}.AutoPopulate.DialogHint`),
            choices
        });
        return result || [];
    }

    /**
     * 覆盖 core 的三格配置对话框，同样只替换标题
     * @returns {Promise<Object|null>}
     */
    async showConfigDialog() {
        const { showAutoPopulateConfigDialog } = await import('/modules/bg3-hud-core/scripts/utils/dialogs.js');

        const choices = await this.getItemTypeChoices();
        if (!choices || choices.length === 0) {
            ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.AutoPopulate.NoTypes`));
            return null;
        }

        return await showAutoPopulateConfigDialog({
            title: game.i18n.localize(`${MODULE_ID}.AutoPopulate.SettingsTitle`),
            description: game.i18n.localize(`${MODULE_ID}.AutoPopulate.SettingsHint`),
            choices,
            configuration: await this.getAutoPopulateSettings(),
            toggleOptions: [
                {
                    key: 'skipUnusable',
                    label: game.i18n.localize(`${MODULE_ID}.AutoPopulate.Options.SkipUnusable`),
                    hint: game.i18n.localize(`${MODULE_ID}.AutoPopulate.Options.SkipUnusableHint`)
                }
            ]
        });
    }

    /**
     * 可供 GM 勾选的类型
     * @returns {Promise<Array<{group:string, choices:Array<{value:string,label:string}>}>>}
     */
    async getItemTypeChoices() {
        const L = (k) => game.i18n.localize(`${MODULE_ID}.AutoPopulate.${k}`);

        // 法术按环位：0（戏法）到 9 环，实际没有的环位会被 getMatchingItems 自然过滤掉
        const spellLevels = [];
        for (let level = 0; level <= 9; level += 1) {
            spellLevels.push({
                value: `spell:${level}`,
                label: level === 0 ? L('Types.Cantrips') : `${level} ${L('Types.SpellRing')}`
            });
        }

        return [
            {
                group: L('Groups.Combat'),
                choices: [
                    { value: 'weapon', label: L('Types.Weapons') },
                    // PF1 里 type=attack 的条目在界面上就叫「战斗」（天生武器/挥击/咬击）
                    { value: 'attack', label: L('Types.Attacks') }
                ]
            },
            {
                group: L('Groups.Features'),
                choices: [
                    // PF1 把专长/职业特性/种族特性/背景特性都存成 type=feat，
                    // 靠 system.subType 区分（pf1.config.featTypes）
                    // 单独的「专长」= subType 为 feat 的普通专长，不含职业特性等
                    { value: 'feat', label: L('Types.Feats') },
                    { value: 'feat:classFeat', label: L('Types.ClassFeatures') },
                    { value: 'feat:racial', label: L('Types.RacialTraits') },
                    { value: 'feat:trait', label: L('Types.Traits') },
                    { value: 'feat:misc', label: L('Types.OtherAbilities') },
                    { value: 'feat:template', label: L('Types.Templates') }
                ]
            },
            {
                group: L('Groups.Magic'),
                choices: [
                    { value: 'spell', label: L('Types.Spells') },
                    ...spellLevels,
                    { value: 'buff', label: L('Types.Buffs') }
                ]
            },
            {
                group: L('Groups.Items'),
                choices: [
                    { value: 'consumable', label: L('Types.Consumables') },
                    { value: 'equipment', label: L('Types.Equipment') },
                    { value: 'loot', label: L('Types.Loot') }
                ]
            }
        ];
    }

    /**
     * 这个物品是否属于选中的类型
     *
     * 支持两种后缀写法：
     *   `feat:classFeat` / `consumable:potion`  → 按 system.subType 匹配
     *   `spell:3`                              → 按法术环位匹配
     *
     * 裸 `feat` 只匹配"普通专长"（subType 为 feat 或没有 subType），
     * 不会把职业特性/种族特性一起带进来——那是单独的选项。
     *
     * @param {Item} item
     * @param {string[]} selectedTypes
     * @returns {boolean}
     */
    _matchesType(item, selectedTypes) {
        if (!item || !selectedTypes?.length) return false;
        for (const entry of selectedTypes) {
            if (!entry) continue;
            const [type, sub] = String(entry).split(':');
            if (item.type !== type) continue;

            if (!sub) {
                // 裸 feat：只算普通专长
                if (type === 'feat') {
                    const itemSub = item.system?.subType ?? 'feat';
                    if (itemSub !== 'feat') continue;
                }
                return true;
            }

            // 法术环位
            if (type === 'spell' && /^\d+$/.test(sub)) {
                if (Number(item.system?.level) === Number(sub)) return true;
                continue;
            }

            const itemSub = item.system?.subType ?? item.system?.consumableType ?? '';
            if (String(itemSub) === sub) return true;
        }
        return false;
    }

    /**
     * 从角色身上挑出符合条件的物品
     * @param {Actor} actor
     * @param {string[]} selectedTypes
     * @param {Object} [options]
     * @returns {Promise<Array<{uuid:string}>>}
     */
    async getMatchingItems(actor, selectedTypes, options = {}) {
        if (!actor?.items) return [];

        const skipUnusable = options?.skipUnusable !== false;
        const result = [];
        const items = actor.items.contents ?? [...actor.items];

        for (const item of items) {
            if (NEVER_POPULATE.has(item.type) && !this._matchesType(item, selectedTypes)) continue;
            if (!this._matchesType(item, selectedTypes)) continue;

            // 数量为 0 的（卷轴用完、箭矢打光）没有实物，不该占格子
            if (!hasStock(item)) continue;

            // 不可使用的物品（既没有次数、也没有可用动作的纯描述物品）默认跳过
            if (skipUnusable && !this._isUsable(item)) continue;

            result.push({ uuid: item.uuid, type: 'Item' });
        }

        return result;
    }

    /**
     * 粗判"这个东西点一下有没有反应"
     * 目的是别把一整本装备表塞进热键栏——真正精细的过滤交给 PF1 自己的物品类型设置。
     * @param {Item} item
     * @returns {boolean}
     */
    _isUsable(item) {
        // 法术永远可用（环位不够只会置灰，不是不能点）
        if (item.type === 'spell') return true;
        // 专长 / 职业特性 / 种族特性：PF1 里它们都能点开（弹卡或触发宏），
        // 很多职业特性既没有 actions 也没有次数，按动作判会把它们全漏掉
        if (item.type === 'feat') return true;
        // 有使用次数的（药水、魔杖、每日能力）
        if (getItemUses(item)) return true;
        // 有攻击动作的武器 / 带动作的其他物品
        const actions = item.system?.actions;
        if (Array.isArray(actions) && actions.length > 0) return true;
        if (item.system?.actionType) return true;
        // 武器至少能投攻击
        if (item.type === 'weapon') return true;
        // 装备只要能穿就行
        if (item.type === 'equipment') return Boolean(item.system?.equipmentType);
        // buff 能往 token 上挂
        if (item.type === 'buff') return true;
        return false;
    }

    /**
     * 排序：先看类型顺序，再按名字（中文按本地化 collator）
     * @param {Array<Object>} items
     * @returns {Promise<Array<Object>>}
     */
    async sortItems(items) {
        const order = ['weapon', 'attack', 'spell', 'feat', 'buff', 'consumable', 'equipment', 'loot'];
        const collator = new Intl.Collator(game.i18n?.lang ?? 'en', { numeric: true });
        const withDocs = await Promise.all(
            (items ?? []).map(async (entry) => {
                let doc = null;
                try {
                    doc = await fromUuid(entry.uuid);
                } catch {
                    doc = null;
                }
                return { entry, doc };
            })
        );
        withDocs.sort((a, b) => {
            const ta = order.indexOf(a.doc?.type ?? '');
            const tb = order.indexOf(b.doc?.type ?? '');
            const oa = ta === -1 ? 99 : ta;
            const ob = tb === -1 ? 99 : tb;
            if (oa !== ob) return oa - ob;
            return collator.compare(a.doc?.name ?? '', b.doc?.name ?? '');
        });
        return withDocs.map((w) => w.entry);
    }

    /**
     * 供 core 在格子渲染时判断"要不要置灰"
     * @param {Item} item
     * @returns {boolean|undefined}
     */
    isDepleted(item) {
        if (item?.type !== 'spell') return undefined;
        return isSpellDepleted(item.actor, item);
    }
}
