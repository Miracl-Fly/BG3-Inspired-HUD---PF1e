/**
 * 被动特性条的显示策略
 *
 * 为什么要单独一层：`Pf1PassivesContainer` 需要动态 import core 的类（走
 * `/modules/bg3-hud-core/...` 绝对路径），在 Node 里 import 不了；把「该不该显示、
 * 显示哪些」的判断抽成纯函数放在这里，测试可以直接 import 它，不用给 core 造桩。
 *
 * 两档：
 *   all    —— 全部常驻特性（职业特性、专长、背景、生效中的增益…）
 *   usable —— 只保留带「使用」次数的（PF1 物品卡的 Uses 区块：职业能力、药水、杖等）
 */

import { getItemUses } from './pf1-data.js';

export const MODULE_ID = 'bg3-hud-pf1';

/** 被动条显示范围 */
export const PASSIVE_FILTER_MODES = Object.freeze({
    ALL: 'all',
    USABLE: 'usable'
});

/**
 * 读设置。取不到就给「显示 + 全部」——HUD 渲染途中绝不能因为设置缺失而抛错。
 * @param {Object} [gameRef] 传入 game 便于测试；默认用全局 game
 * @returns {{show:boolean, mode:string}}
 */
export function readPassiveSettings(gameRef) {
    const g = gameRef ?? (typeof game !== 'undefined' ? game : undefined);
    const read = (key, fallback) => {
        try {
            const value = g?.settings?.get?.(MODULE_ID, key);
            return value === undefined || value === null ? fallback : value;
        } catch {
            return fallback;
        }
    };

    const show = read('showPassives', true) !== false;
    const rawMode = String(read('passiveFilter', PASSIVE_FILTER_MODES.ALL));
    const mode = rawMode === PASSIVE_FILTER_MODES.USABLE
        ? PASSIVE_FILTER_MODES.USABLE
        : PASSIVE_FILTER_MODES.ALL;

    return { show, mode };
}

/**
 * 这个物品带不带「使用」次数（uses / charges）。
 * @param {Item} item
 * @returns {boolean}
 */
export function itemHasUses(item) {
    const uses = getItemUses(item);
    return Boolean(uses && uses.max > 0);
}

/**
 * 按设置筛出该显示的被动特性。
 * @param {Array<Item>} items 候选（一般是 getPassiveItems() 的结果）
 * @param {string} mode all | usable
 * @returns {Array<Item>}
 */
export function filterPassiveItems(items, mode) {
    const list = Array.isArray(items) ? items : [];
    if (mode !== PASSIVE_FILTER_MODES.USABLE) return list;
    return list.filter((item) => itemHasUses(item));
}
