/**
 * 按血量给 token 染色
 *
 * BG3 网页里是 token 本身随血量变色（黄 → 橙红 → 深红 → 倒地灰），
 * 这里照做：写 token 文档的 `texture.tint`，所以队友也能看到。
 *
 * 两个注意点：
 *   1. 只在颜色真的变了才写文档，否则每次 updateHealth 都会刷一次数据库。
 *   2. 第一次染色前把原色记进 flag，血量恢复时还原，不会把 token 永久染红。
 */

const MODULE_ID = 'bg3-hud-pf1';
const FLAG_KEY = 'originalTint';

/** 各档颜色（导出方便测试和诊断对账） */
export const HP_TINTS = {
    dead: '#6b6b6b', // 倒地
    staggered: '#7d3f98', // 瘀伤 ≥ 当前生命值（晕眩/昏迷）
    critical: '#a32424', // ≤ 25%
    low: '#d97b3a', // ≤ 50%
    medium: '#e8d27a' // ≤ 75%
};

/**
 * 血量 → 颜色
 * @param {{value:number, max?:number, ratio?:number, nonlethal?:number}} hp
 * @returns {string} 空字符串表示"保持原色"
 */
export function getTintForHealth(hp) {
    const value = Number(hp?.value) || 0;
    const nonlethal = Number(hp?.nonlethal) || 0;
    const max = Math.max(Number(hp?.max) || 1, 1);
    const ratio = typeof hp?.ratio === 'number' ? hp.ratio : value / max;

    if (value <= 0) return HP_TINTS.dead;
    // 瘀伤 ≥ 当前生命值：PF1 规则里角色晕眩/昏迷，比"伤得重"更该被看见
    if (nonlethal > 0 && nonlethal >= value) return HP_TINTS.staggered;
    if (ratio > 0.75) return '';
    if (ratio > 0.5) return HP_TINTS.medium;
    if (ratio > 0.25) return HP_TINTS.low;
    return HP_TINTS.critical;
}

/**
 * 给单个 token 上色 / 还原
 * @param {Token} token
 * @param {string} tint 空字符串表示还原成原色
 * @returns {Promise<void>}
 */
export async function applyTokenTint(token, tint) {
    const doc = token?.document;
    if (!doc) return;
    // 没权限改文档，改了也会被拒绝
    if (!(game.user?.isGM || doc.isOwner)) return;

    const current = doc.texture?.tint ?? '';
    const stored = doc.getFlag?.(MODULE_ID, FLAG_KEY);

    if (tint) {
        if (current !== tint) {
            // 第一次染色：先记住原色
            if (stored === undefined) {
                try {
                    await doc.setFlag(MODULE_ID, FLAG_KEY, current);
                } catch {
                    /* flag 写不进去不影响染色 */
                }
            }
            await doc.update({ 'texture.tint': tint });
        }
        // 兜底：文档更新被拒 / 尚未重绘时，先让当前客户端看到
        if (token.mesh) token.mesh.tint = tint;
        return;
    }

    if (stored !== undefined) {
        if (current !== stored) await doc.update({ 'texture.tint': stored });
        try {
            await doc.unsetFlag(MODULE_ID, FLAG_KEY);
        } catch {
            /* ignore */
        }
        if (token.mesh) token.mesh.tint = stored || 0xffffff;
    } else if (current) {
        await doc.update({ 'texture.tint': '' });
        if (token.mesh) token.mesh.tint = 0xffffff;
    }
}

/**
 * 同步一个 actor 所有 token 的颜色（HUD 上的那个优先）
 * @param {Actor|null} actor
 * @param {Token} [preferred] 优先处理的 token
 * @returns {Promise<void>}
 */
export async function syncActorTint(actor, preferred) {
    if (!actor) return;
    let enabled = false;
    try {
        enabled = game.settings.get(MODULE_ID, 'tintTokenByHealth') === true;
    } catch {
        enabled = false; // 设置还没注册好时按默认（关）
    }

    const placeables = canvas?.tokens?.placeables ?? [];
    const tokens = preferred?.document
        ? [preferred, ...placeables.filter((t) => t !== preferred && t.actor?.id === actor.id)]
        : placeables.filter((t) => t.actor?.id === actor.id);

    // 关了也要收拾旧版本留下的染色：带 originalTint 的一律还原
    if (!enabled) {
        for (const token of tokens) {
            const stored = token?.document?.getFlag?.(MODULE_ID, FLAG_KEY);
            if (stored === undefined) continue;
            try {
                await applyTokenTint(token, '');
            } catch {
                /* 还原失败不影响其它功能 */
            }
        }
        return;
    }

    const tint = getTintForHealth(actor.system?.attributes?.hp ?? {});

    for (const token of tokens) {
        try {
            await applyTokenTint(token, tint);
        } catch (error) {
            // 染色只是装饰，坏了不能影响血条/使用物品
            console.warn(`${MODULE_ID} | 给 token 染色失败（不影响其它功能）`, error);
            return;
        }
    }
}
