/**
 * PF1 武器组
 *
 * BG3 的"武器组"在 PF1 里对应的概念是：一组手上拿着的武器 + 切换时换手。
 * core 已经把 UI、拖拽、持久化做完了（3 组、每组 2 格），适配器只需要回答：
 *   - 切到某一组时，身体上到底怎么换手（onSetSwitch）
 *   - 哪些格子算"手持"（adapter.isHeldItem）
 *   - 哪些算双手武器（adapter.isTwoHanded）
 *
 * PF1 的换手 = 改 `item.system.equipped`（武器/盾牌都吃这个字段）。
 * 注意：连续 update 会触发多次重绘，所以这里先把要改的收集起来，再一次性 update。
 */

export async function createPf1WeaponSetContainer() {
    const { WeaponSetContainer } = await import(
        '/modules/bg3-hud-core/scripts/components/containers/WeaponSetContainer.js'
        );

    return class Pf1WeaponSetContainer extends WeaponSetContainer {
        /**
         * 切换武器组
         * @param {number} setIndex 目标组
         * @param {HTMLElement} setContainer
         */
        async onSetSwitch(setIndex, setContainer) {
            await super.onSetSwitch(setIndex, setContainer);

            if (!this.actor) return;

            const sets = this.weaponSets ?? [];
            /** @type {Map<Item, boolean>} */
            const desired = new Map();

            // 目标组里的武器 → 装备；其它组里的 → 卸下
            sets.forEach((set, index) => {
                const wanted = index === setIndex;
                for (const cell of Object.values(set?.items ?? {})) {
                    const uuid = cell?.uuid;
                    if (!uuid) continue;
                    const item = this._findItemByUuid(uuid);
                    if (!item) continue;
                    // 只有能"拿在手上"的才换手，护甲/戒指一律不碰
                    if (!['weapon', 'equipment', 'shield'].includes(item.type)) continue;
                    desired.set(item, wanted);
                }
            });

            if (!desired.size) return;

            const updates = [];
            for (const [item, wanted] of desired) {
                const current = item.system?.equipped === true;
                if (current === wanted) continue;
                updates.push({ _id: item.id, 'system.equipped': wanted });
            }

            if (!updates.length) return;

            try {
                // 一次 updateEmbeddedDocuments 改完，避免连续重绘
                await this.actor.updateEmbeddedDocuments('Item', updates);
            } catch (error) {
                console.error('bg3-hud-pf1 | 切换武器组时换手失败', error);
            }
        }

        /**
         * 在角色身上按 uuid 找物品（HUD 的 uuid 可能指向世界物品或嵌入物品）
         * @param {string} uuid
         * @returns {Item|null}
         */
        _findItemByUuid(uuid) {
            const embedded = this.actor?.items?.get?.(uuid.split('.').pop());
            if (embedded) return embedded;
            // 兜底：从 uuid 里取 id 再查一次
            const id = uuid?.split('.').pop();
            return id ? (this.actor?.items?.get?.(id) ?? null) : null;
        }
    };
}
