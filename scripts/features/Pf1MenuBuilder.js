/**
 * PF1 右键菜单构造器
 *
 * core 的约定（registry.js `registerMenuBuilder(systemId, builderClass, { adapter })`）：
 * 各容器在弹出右键菜单前会先问 `BG3HUD_API.getMenuBuilder()` 要菜单项：
 *
 *   PortraitContainer  → buildPortraitMenu(portraitContainer, event)
 *   ControlContainer   → buildSettingsMenu(controlContainer, event) / buildLockMenu(...)
 *   AbilityContainer   → buildAbilityMenu(abilityContainer, event)
 *
 * 一旦注册了 builder，**返回空数组也会回落到 core 自己的菜单**（各容器里都有
 * `if (menuItems.length === 0) menuItems = this._getCore...MenuItems()`），
 * 所以这里只填 PF1 真正能做的事，其余交给 core，不用假装实现。
 *
 * 菜单项形状与 core 一致：{ label, icon, onClick }，分隔线是 { separator: true }。
 */

import { openAutoPopulateConfigDialog } from '../utils/settings.js';
import { rollInitiative } from './Pf1ItemUse.js';
import { runDiagnostics } from '../utils/diagnostics.js';

export async function createPf1MenuBuilder() {
    const { MenuBuilder } = await import(
        '/modules/bg3-hud-core/scripts/components/ui/MenuBuilder.js'
        );

    return class Pf1MenuBuilder extends MenuBuilder {
        /**
         * 肖像右键
         * @param {Object} container PortraitContainer 实例
         * @returns {Promise<Array<Object>>}
         */
        async buildPortraitMenu(container) {
            const actor = container?.actor;
            if (!actor) return [];

            const items = [
                {
                    label: '打开角色卡',
                    icon: 'fas fa-address-card',
                    onClick: () => actor.sheet?.render(true)
                },
                {
                    label: '投先攻',
                    icon: 'fas fa-bolt',
                    onClick: () => rollInitiative(actor, null, container?.token)
                }
            ];

            // 血条与调血对话框是肖像容器自己提供的，有就用，没有就不显示这一项
            if (typeof container?._promptHpChange === 'function') {
                items.push({
                    label: '调整生命值',
                    icon: 'fas fa-heart-pulse',
                    onClick: () => container._promptHpChange()
                });
            }

            return items;
        }

        /**
         * 控制按钮（设置/锁）右键
         * 保留 core 自带的重置布局 / 清空格子 / 保存布局，再补 PF1 自己的两项
         * @param {Object} container ControlContainer 实例
         * @returns {Promise<Array<Object>>}
         */
        async buildSettingsMenu(container) {
            const items = [];

            // core 自带的菜单项（容器没这个私有方法时就是空，回落由调用方处理）
            if (typeof container?._getCoreSettingsMenuItems === 'function') {
                try {
                    items.push(...container._getCoreSettingsMenuItems());
                } catch {
                    /* 拿不到就算了，下面还有 PF1 的条目 */
                }
            }

            if (items.length > 0) items.push({ separator: true });

            items.push(
                {
                    label: '自动填充配置…',
                    icon: 'fas fa-sliders',
                    onClick: async () => {
                        await openAutoPopulateConfigDialog();
                    }
                },
                {
                    label: '运行诊断（输出到控制台）',
                    icon: 'fas fa-stethoscope',
                    onClick: async () => {
                        await runDiagnostics();
                        ui.notifications?.info('诊断已输出到浏览器控制台（F12）');
                    }
                }
            );

            return items;
        }

        /**
         * 锁定菜单：PF1 没有额外需要锁的东西，返回空让 core 用默认的
         */
        async buildLockMenu() {
            return [];
        }

        /**
         * 属性菜单：PF1 的属性投骰在信息面板里已经有按钮，这里不重复
         */
        async buildAbilityMenu() {
            return [];
        }
    };
}
