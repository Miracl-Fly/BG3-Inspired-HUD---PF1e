/**
 * 补 bg3-hud-core 缺的中文
 *
 * core 只带 en / pl / pt-BR 三种语言，而自动填充相关的一批文案是写死英文的
 * （`ContextMenu.AutoPopulate*`、`Notifications.*`），配置对话框里的
 * 「Hotbar Grid {number}」「Options」走的是 `bg3-hud-core.*` 键，中文环境下没人提供翻译。
 *
 * 模块自己的语言文件只能覆盖自己命名空间下的键，所以这里在 init 阶段把缺的几条
 * 直接补进 `game.i18n.translations[lang]`。只在中文环境下动手，且只碰我列出来的这几个键，
 * 不整体覆盖 core 的翻译表。
 */

/** 需要补的 core 键 → 中文 */
const CORE_ZH = {
    'Settings.AutoPopulate.Options': '选项',
    'Settings.AutoPopulate.HotbarGrid': '热键栏第 {number} 格',
    'ContextMenu.AutoPopulateContainer': '自动填充本格',
    'ContextMenu.AutoPopulateHint':
        '手动用角色身上的物品填充这一格。注意：NPC 在创建 token 时会自动填充，玩家角色请用这一项。',
    'Notifications.AutoPopulateFailed': '自动填充失败',
    'Notifications.NoActorForAutoPopulate': '没有可用的角色，无法自动填充',
    'Notifications.NoItemTypesForAutoPopulate': '没有可填充的物品类型',
    'Notifications.NoItemTypesForConfig': '没有可配置的物品类型'
};

/** 只有这些语言才补（cn.foundry_chn 用 "cn"，也有人用 zh / zh-CN） */
const ZH_LANGS = /^(cn|zh)([-_].*)?$/i;

/**
 * 把缺的中文补进 core 的命名空间
 * @returns {number} 补了多少条（非中文环境返回 0）
 */
export function applyCoreTranslationOverrides() {
    const lang = globalThis.game?.i18n?.lang;
    if (!lang || !ZH_LANGS.test(lang)) return 0;

    const translations = game.i18n.translations;
    if (!translations) return 0;

    // core 的翻译可能还没加载（极端情况下 translations[lang] 是空的），那就补一个空壳进去
    const table = (translations[lang] ??= {});
    const namespace = (table['bg3-hud-core'] ??= {});

    let count = 0;
    for (const [key, value] of Object.entries(CORE_ZH)) {
        const setter = globalThis.foundry?.utils?.setProperty;
        if (typeof setter === 'function') {
            // 同时兼顾两种写法：扁平的 "a.b.c" 键，以及真正嵌套的对象
            setter(namespace, key, value);
        } else {
            namespace[key] = value;
        }
        count++;
    }
    return count;
}

export { CORE_ZH };
