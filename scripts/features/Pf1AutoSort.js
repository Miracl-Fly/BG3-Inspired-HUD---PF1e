/**
 * PF1 自动排序
 *
 * core 的 AutoSortFramework 负责"读容器里所有格子 → 排序 → 写回"这一整套，
 * 适配器只需要定义"什么算排在前面的"。
 *
 * PF1 的排序思路（和 D&D 系的顺手顺序一致）：
 *   武器/天生攻击 → 法术（按环位从低到高）→ 专长 → 增益 → 消耗品 → 装备 → 其它
 * 同一类里按名字（中文按本地化 collator，数字按数值比较，所以"法术 2"排在"法术 10"前面）。
 */

import { loadCoreClass } from '../utils/coreBridge.js';

// 顶层 await：core 的内部文件改名时，只降级自动排序，不会让整个模块加载失败
const AutoSortFramework = await loadCoreClass('AutoSortFramework');

/** 类型顺序；不在表里的排最后 */
const TYPE_ORDER = ['weapon', 'attack', 'spell', 'feat', 'buff', 'consumable', 'equipment', 'loot'];
const LAST = 99;

const typeOrder = (type) => {
    const index = TYPE_ORDER.indexOf(type);
    return index === -1 ? LAST : index;
};

export class Pf1AutoSort extends AutoSortFramework {
    /**
     * 补齐排序需要的字段（core 只保证有 uuid）
     * @param {Array<Object>} items
     */
    async enrichItemsForSort(items) {
        for (const entry of items ?? []) {
            if (!entry?.uuid) continue;
            try {
                const doc = await fromUuid(entry.uuid);
                if (doc) {
                    entry.name = doc.name ?? entry.name;
                    entry.type = doc.type ?? entry.type;
                    entry.sortData = {
                        name: doc.name ?? '',
                        typeOrder: typeOrder(doc.type),
                        level: doc.type === 'spell' ? Number(doc.system?.level) || 0 : LAST
                    };
                    continue;
                }
            } catch {
                /* 解析不到就退回已有字段 */
            }
            entry.sortData = {
                name: entry.name ?? '',
                typeOrder: typeOrder(entry.type),
                level: LAST
            };
        }
    }

    /**
     * 原地排序
     * @param {Array<Object>} items
     */
    async sortItems(items) {
        const collator = new Intl.Collator(game.i18n?.lang ?? 'en', { numeric: true });
        items.sort((a, b) => {
            const dataA = a.sortData ?? {};
            const dataB = b.sortData ?? {};

            const orderA = dataA.typeOrder ?? LAST;
            const orderB = dataB.typeOrder ?? LAST;
            if (orderA !== orderB) return orderA - orderB;

            const levelA = dataA.level ?? LAST;
            const levelB = dataB.level ?? LAST;
            if (levelA !== levelB) return levelA - levelB;

            return collator.compare(dataA.name ?? a.name ?? '', dataB.name ?? b.name ?? '');
        });
    }
}
