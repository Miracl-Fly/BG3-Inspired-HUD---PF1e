/**
 * PF1 物品使用 / 投骰
 *
 * PF1 v11 的入口：
 *   item.use()            —— 走完整的"使用物品"流程（武器会弹攻击对话框，消耗品会扣次数）
 *   actor.rollSkill(id)   —— 技能
 *   actor.rollSavingThrow(id) —— 豁免
 *   actor.rollAbilityTest(id) —— 属性检定
 *   actor.rollInitiative()    —— 先攻
 *
 * 这些函数都会自己弹对话框、发聊天卡，所以这里只负责"拿到文档并调用"，
 * 不要在这里重复实现规则逻辑——否则会和系统自己的设置（跳过对话、自动投骰）打架。
 */

/**
 * 解析 UUID（同步优先，失败再异步）
 * @param {string} uuid
 * @returns {Promise<Document|null>}
 */
export async function resolveDoc(uuid) {
    if (!uuid) return null;
    try {
        if (typeof fromUuidSync === 'function') {
            const doc = fromUuidSync(uuid);
            if (doc) return doc;
        }
    } catch {
        /* 不是当前客户端的缓存，走异步 */
    }
    try {
        return await fromUuid(uuid);
    } catch {
        return null;
    }
}

/**
 * 使用一个物品（武器/法术/消耗品/专长…都走这里）
 * @param {string} uuid
 * @param {MouseEvent} [event]
 * @returns {Promise<void>}
 */
export async function useItem(uuid, event = null) {
    const item = await resolveDoc(uuid);
    if (!item) {
        ui.notifications?.warn('HUD：找不到这个物品（可能已被删除）');
        return;
    }

    // Shift+点击：跳过对话框直接使用（PF1 自己会读 event.shiftKey，这里把 event 传下去）
    try {
        await item.use({ event, ev: event });
    } catch (error) {
        console.error('bg3-hud-pf1 | item.use 失败', item, error);
        ui.notifications?.error(`使用「${item.name}」失败：${error?.message ?? error}`);
    }
}

/**
 * 从格子数据里取"要滚的东西"
 * @param {Item} item
 * @param {'attack'|'damage'|'use'} mode
 * @param {MouseEvent} [event]
 */
export async function rollFromItem(item, mode, event = null) {
    if (!item) return;
    const warn = (message) => ui.notifications?.warn(message);
    try {
        if (mode === 'attack') {
            if (typeof item.rollAttack !== 'function') {
                warn(`「${item.name}」不支持单独投攻击`);
                return;
            }
            await item.rollAttack({ ev: event, event });
            return;
        }
        if (mode === 'damage') {
            // PF1 的单独伤害投骰需要物品自己的 rollData（含动作），
            // 有些武器/物品没有这个入口，这时给个提示，别让按钮点了没反应
            if (typeof item.rollDamage !== 'function') {
                warn(`「${item.name}」不能单独投伤害，请用左键的完整使用流程`);
                return;
            }
            await item.rollDamage({ ev: event, event });
            return;
        }
        await useItem(item.uuid, event);
    } catch (error) {
        console.error('bg3-hud-pf1 | 投骰失败', item, error);
        warn(`投骰失败：${error?.message ?? error}`);
    }
}

/** 技能检定 */
export async function rollSkill(actor, skillId, event = null) {
    try {
        await actor?.rollSkill?.(skillId, { event, ev: event });
    } catch (error) {
        console.error('bg3-hud-pf1 | rollSkill 失败', skillId, error);
    }
}

/** 豁免 */
export async function rollSave(actor, saveId, event = null) {
    try {
        await actor?.rollSavingThrow?.(saveId, { event, ev: event });
    } catch (error) {
        console.error('bg3-hud-pf1 | rollSavingThrow 失败', saveId, error);
    }
}

/** 属性检定 */
export async function rollAbility(actor, abilityId, event = null) {
    try {
        await actor?.rollAbilityTest?.(abilityId, { event, ev: event });
    } catch (error) {
        console.error('bg3-hud-pf1 | rollAbilityTest 失败', abilityId, error);
    }
}

/** 先攻（没有战斗会自己建一个，否则点了没反应） */
export async function rollInitiative(actor, event = null, token = null) {
    try {
        await actor?.rollInitiative?.({
            createCombatants: true,
            rerollInitiative: game.user?.isGM ?? false,
            token: token ?? null,
            event,
            ev: event
        });
    } catch (error) {
        console.error('bg3-hud-pf1 | rollInitiative 失败', error);
        ui.notifications?.warn(`投先攻失败：${error?.message ?? error}`);
    }
}

/**
 * 直接改 HP（血条右键用）
 * @param {Actor} actor
 * @param {number} delta 正数治疗，负数受伤
 */
export async function applyHpDelta(actor, delta) {
    const hp = actor?.system?.attributes?.hp;
    if (!hp) return;
    const max = Number(hp.max) || 1;
    const next = Math.max(0, Math.min(max, (Number(hp.value) || 0) + Number(delta)));
    try {
        await actor.update({ 'system.attributes.hp.value': next });
    } catch (error) {
        console.error('bg3-hud-pf1 | 修改 HP 失败', error);
    }
}

/**
 * 直接改瘀伤（非致命伤害）
 * @param {Actor} actor
 * @param {number} delta 正数增加瘀伤，负数减少
 */
export async function applyNonlethalDelta(actor, delta) {
    const hp = actor?.system?.attributes?.hp;
    if (!hp) return;
    const current = Number(hp.nonlethal) || 0;
    const next = Math.max(0, current + Number(delta));
    try {
        await actor.update({ 'system.attributes.hp.nonlethal': next });
    } catch (error) {
        console.error('bg3-hud-pf1 | 修改瘀伤失败', error);
    }
}
