/**
 * bg3-hud-pf1 —— 系统适配设置
 *
 * 核心（bg3-hud-core）会直接读取其中几个键，缺一个就会静默跳过某个功能：
 *   - autoPopulateConfiguration / autoPopulateEnabled / autoPopulatePlayerCharacters
 *     → createToken 时的自动填充（core/scripts/module.js 里读）
 *   - showItemNames / showItemUses
 *     → BG3HUD_API.getDisplaySettings(MODULE_ID)（格子上的名字与使用次数）
 *
 * 所以这里注册的名字、scope、type 必须与 core 的读取方式一致，不能改名。
 */

const MODULE_ID = 'bg3-hud-pf1';

/**
 * 默认自动填充：0 号格放武器与攻击，1 号格放法术，2 号格放专长/增益/消耗品
 *
 * 注意 `options` 必须嵌在 options 下面：core 的 `_populateInitialStateByGrid` 读的是
 * `configuration.options || {}`，写在顶层它读不到（会静默变成空对象）。
 */
const DEFAULT_AUTO_POPULATE_CONFIGURATION = {
    grid0: ['weapon', 'attack'],
    grid1: ['spell'],
    // 专长（普通）+ 职业特性 + 增益 + 消耗品
    grid2: ['feat', 'feat:classFeat', 'buff', 'consumable'],
    options: {
        // 过滤掉"点了没反应"的纯描述物品
        skipUnusable: true,
        // PF1 没有 dnd5e 的 activity，开了也没用
        includeActivities: false
    }
};

/**
 * 「自动填充格子配置」设置菜单
 *
 * Foundry 的 settings 菜单只会 `new type().render()`，而 `registerMenu` 在 v13 里
 * **强制要求 type 是 FormApplication / ApplicationV2 的子类**，否则 init 阶段直接抛：
 *   "You must provide a menu type that is a FormApplication or ApplicationV2 instance or subclass"
 * 所以外壳必须真的继承一个 Application；界面本身仍然是 core 自带的配置对话框。
 *
 * @returns {Function|null} 可注册的类（两个基类都没有时返回 null）
 */
function createAutoPopulateConfigMenuClass() {
    const Base =
        globalThis.foundry?.applications?.api?.ApplicationV2 ??
        globalThis.foundry?.applications?.api?.Application ??
        globalThis.FormApplication ??
        null;
    if (!Base) return null;

    return class Pf1AutoPopulateConfigMenu extends Base {
        static DEFAULT_OPTIONS = {
            id: 'bg3-hud-pf1-auto-populate-config',
            classes: ['bg3-hud-pf1-config-menu'],
            window: {
                title: 'bg3-hud-pf1.Settings.ConfigureAutoPopulateGrids',
                resizable: false
            },
            position: { width: 480, height: 'auto' }
        };

        /**
         * 这个"窗口"只是 registerMenu 需要的壳：真正的界面是 core 的配置对话框，
         * 所以 render() 直接把它拉起来，自己不画任何东西。
         * @returns {Promise<this>}
         */
        async render() {
            await openAutoPopulateConfigDialog();
            return this;
        }

        /** 让任何统一的清理逻辑都能安全调用 */
        async close() {
            return this;
        }
    };
}

/**
 * 打开 core 的自动填充配置对话框并保存结果
 * （设置菜单和控制按钮右键菜单都走这里，避免两份逻辑）
 * @returns {Promise<Object|null>} 保存后的配置，取消则为 null
 */
export async function openAutoPopulateConfigDialog() {
    const t = (key) => game.i18n.localize(`${MODULE_ID}.${key}`);
    const adapter = ui.BG3HOTBAR?.api?.getActiveAdapter?.();
    const autoPopulate = adapter?.autoPopulate;

    if (!autoPopulate?.showConfigDialog) {
        ui.notifications?.warn(t('Notifications.NotReady'));
        return null;
    }

    try {
        const configuration = await autoPopulate.showConfigDialog();
        if (!configuration) return null; // 用户取消
        await game.settings.set(MODULE_ID, 'autoPopulateConfiguration', configuration);
        ui.notifications?.info(t('Notifications.Saved'));
        return configuration;
    } catch (error) {
        console.error('bg3-hud-pf1 | 打开自动填充配置失败', error);
        ui.notifications?.error(t('Notifications.SaveFailed'));
        return null;
    }
}

export function registerSettings() {
    /* ── 显示 ───────────────────────────────────────────── */
    game.settings.register(MODULE_ID, 'showItemNames', {
        name: 'bg3-hud-pf1.Settings.ShowItemNames',
        hint: 'bg3-hud-pf1.Settings.ShowItemNamesHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, 'showItemUses', {
        name: 'bg3-hud-pf1.Settings.ShowItemUses',
        hint: 'bg3-hud-pf1.Settings.ShowItemUsesHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, 'showHealthOverlay', {
        name: 'bg3-hud-pf1.Settings.ShowHealthOverlay',
        hint: 'bg3-hud-pf1.Settings.ShowHealthOverlayHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    // 物品的施法者等级（CL）：显示在悬停提示框标题行右侧，默认关
    game.settings.register(MODULE_ID, 'showCasterLevel', {
        name: 'bg3-hud-pf1.Settings.ShowCasterLevel',
        hint: 'bg3-hud-pf1.Settings.ShowCasterLevelHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    // 卷轴/药水/魔杖的环数与豁免 DC：和 CL 并排显示，默认开
    game.settings.register(MODULE_ID, 'showSpellInfo', {
        name: 'bg3-hud-pf1.Settings.ShowSpellInfo',
        hint: 'bg3-hud-pf1.Settings.ShowSpellInfoHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    // 地图上的 token 按血量染色（默认关；HUD 肖像上的红色蒙层才是主效果）
    game.settings.register(MODULE_ID, 'tintTokenByHealth', {
        name: 'bg3-hud-pf1.Settings.TintTokenByHealth',
        hint: 'bg3-hud-pf1.Settings.TintTokenByHealthHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    /* ── 被动特性条（肖像上方那排小图标） ─────────────── */
    // 要不要显示整条 + 显示多少，都是纯显示偏好，所以给 client 作用域
    game.settings.register(MODULE_ID, 'showPassives', {
        name: 'bg3-hud-pf1.Settings.ShowPassives',
        hint: 'bg3-hud-pf1.Settings.ShowPassivesHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, 'passiveFilter', {
        name: 'bg3-hud-pf1.Settings.PassiveFilter',
        hint: 'bg3-hud-pf1.Settings.PassiveFilterHint',
        scope: 'client',
        config: true,
        type: String,
        choices: {
            all: 'bg3-hud-pf1.Settings.PassiveFilterAll',
            usable: 'bg3-hud-pf1.Settings.PassiveFilterUsable'
        },
        default: 'all'
    });

    /* ── 自动填充 ───────────────────────────────────────── */
    game.settings.register(MODULE_ID, 'autoPopulateEnabled', {
        name: 'bg3-hud-pf1.Settings.AutoPopulateEnabled',
        hint: 'bg3-hud-pf1.Settings.AutoPopulateEnabledHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, 'autoPopulatePlayerCharacters', {
        name: 'bg3-hud-pf1.Settings.AutoPopulatePCs',
        hint: 'bg3-hud-pf1.Settings.AutoPopulatePCsHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, 'autoPopulatePassivesEnabled', {
        name: 'bg3-hud-pf1.Settings.AutoPopulatePassives',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, 'autoPopulateConfiguration', {
        name: 'bg3-hud-pf1.Settings.AutoPopulateConfiguration',
        scope: 'world',
        config: false,
        restricted: true,
        type: Object,
        default: foundry.utils.deepClone(DEFAULT_AUTO_POPULATE_CONFIGURATION)
    });

    // 肖像上按受伤比例浮起的红色蒙层（BG3 网页的效果）
    game.settings.register(MODULE_ID, 'portraitDamageOverlay', {
        name: 'bg3-hud-pf1.Settings.DamageOverlay',
        hint: 'bg3-hud-pf1.Settings.DamageOverlayHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    // 让 GM 能改「哪个格放哪些类型」——没有这个菜单，配置只能靠改代码
    const ConfigMenu = createAutoPopulateConfigMenuClass();
    if (ConfigMenu) {
        try {
            game.settings.registerMenu(MODULE_ID, 'autoPopulateConfigurationMenu', {
                name: 'bg3-hud-pf1.Settings.ConfigureAutoPopulateGrids',
                label: 'bg3-hud-pf1.Settings.ConfigureGrids',
                hint: 'bg3-hud-pf1.Settings.ConfigureGridsHint',
                icon: 'fas fa-grid-2',
                type: ConfigMenu,
                restricted: true
            });
        } catch (error) {
            // 菜单注册失败不该拖垮整个 init（其它设置仍然可用）
            console.warn(`${MODULE_ID} | 注册「自动填充配置」菜单失败`, error);
        }
    }

    /* ── 兼容开关 ───────────────────────────────────────── */
    game.settings.register(MODULE_ID, 'ignoreGroupActors', {
        name: 'bg3-hud-pf1.Settings.IgnoreGroupActors',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });
}

export { DEFAULT_AUTO_POPULATE_CONFIGURATION };
