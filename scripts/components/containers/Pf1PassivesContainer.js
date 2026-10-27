/**
 * PF1 被动能力条
 *
 * PF1 没有 PF2e 那种明确的 "passive" 标记，所以这里的判定是：
 *   1) 正在生效的增益（buff，system.active 且不是临时性持续时间）
 *   2) 不带动作的专长/能力（纯被动，点了没反应但需要随时看见）
 *
 * core 负责按钮渲染与点击，这里只负责"给我哪些物品"。
 *
 * 显示策略（两个客户端设置，见 scripts/utils/settings.js）：
 *   showPassives   —— 关掉就整条隐藏（连同格子里的图标一起）
 *   passiveFilter  —— all（全部常驻特性）/ usable（只留带「使用」次数的）
 */

import { readPassiveSettings, filterPassiveItems, PASSIVE_FILTER_MODES } from '../../utils/passiveFilter.js';

export async function createPf1PassivesContainer() {
    const { PassivesContainer } = await import(
        '/modules/bg3-hud-core/scripts/components/containers/PassivesContainer.js'
        );

    return class Pf1PassivesContainer extends PassivesContainer {
        /**
         * 应该显示在被动条上的物品
         * @returns {Array<Item>}
         */
        getPassiveItems() {
            const actor = this.actor;
            if (!actor?.items) return [];

            const items = actor.items.contents ?? [...actor.items];
            return items.filter((item) => this._isPassive(item));
        }

        /**
         * 用户设置过哪些要显示
         *
         * core 的基类默认「全选」，PF1 这边没有「手动勾选」那一套，改成按设置筛：
         *   showPassives=false → 空集合（整条不显示）
         *   passiveFilter=usable → 只保留带「使用」次数的
         * @returns {Set<string>}
         */
        getSelectedPassives() {
            const { show, mode } = readPassiveSettings();
            if (!show) return new Set();

            const visible = filterPassiveItems(this.getPassiveItems(), mode);
            return new Set(visible.map((item) => item.uuid));
        }

        /**
         * 关掉被动条时把容器也藏起来，避免空容器继续占位/挡点击
         * @returns {Promise<HTMLElement>}
         */
        async render() {
            const element = await super.render();
            const { show } = readPassiveSettings();
            element?.classList?.toggle('pf1-passives-hidden', !show);
            return element;
        }

        /**
         * 让「右键/齿轮」配置对话框说清楚这里没有手动勾选，只有两个设置
         * @param {Event} event
         */
        async showConfigurationDialog(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();

            const { show, mode } = readPassiveSettings();
            const L = (k) => game.i18n.localize(`bg3-hud-pf1.Settings.${k}`);
            const modeLabel = mode === PASSIVE_FILTER_MODES.USABLE
                ? L('PassiveFilterUsable')
                : L('PassiveFilterAll');

            ui.notifications?.info(
                game.i18n.format('bg3-hud-pf1.Notifications.PassivesConfig', {
                    state: show ? L('ShowPassivesOn') : L('ShowPassivesOff'),
                    mode: modeLabel
                })
            );
        }

        /**
         * @param {Item} item
         * @returns {boolean}
         * @private
         */
        _isPassive(item) {
            if (!item) return false;

            // 增益：正在生效、且没有倒计时（有倒计时的应该看 active effects 条）
            if (item.type === 'buff') {
                const active = item.system?.active !== false;
                const duration = item.system?.duration;
                const timed = Boolean(duration?.value) || Boolean(duration?.units && duration?.value);
                return active && !timed;
            }

            // 专长：没有动作 = 被动；有动作的是主动能力，应该在热键栏
            if (item.type === 'feat') {
                const actions = item.system?.actions;
                const hasActions = Array.isArray(actions) ? actions.length > 0 : Boolean(item.system?.actionType);
                return !hasActions;
            }

            return false;
        }
    };
}
