/**
 * 与 bg3-hud-core 的运行时桥接
 *
 * 我们的适配器要继承 core 的两个基类：`AutoPopulateFramework` / `AutoSortFramework`。
 * 它们是 core 的**内部文件**，不在 `bg3HudReady` 的公开契约里——core 哪天重构目录，
 * 静态 `import` 会让整个模块图加载失败（连肖像、血条一起挂掉）。
 *
 * 所以这里用「动态 import + 多路径 + 公开 API 兜底 + 占位类」的策略：
 *   1) 按已知路径动态 import，失败就试下一个候选
 *   2) 再试 core 暴露在 ui/game 上的 api 对象
 *   3) 全失败就给一个空壳基类，只让"自动填充/排序"这一个功能降级，
 *      其余组件照常工作，并在控制台留一条能看懂的原因
 */

const MODULE_ID = 'bg3-hud-pf1';
const CORE_MODULE_ID = 'bg3-hud-core';
const CORE_FEATURES = `/modules/${CORE_MODULE_ID}/scripts/features`;

/** 已经警告过的类名，避免刷屏 */
const warned = new Set();

/**
 * 做一个空壳基类：能 new、能被子类继承，但不提供任何能力
 * @param {string} name
 * @returns {Function}
 */
function makeStub(name) {
    return class MissingCoreFeature {
        constructor() {
            if (!warned.has(name)) {
                warned.add(name);
                console.warn(
                    `${MODULE_ID} | 没能从 ${CORE_MODULE_ID} 载入 ${name}，` +
                        '自动填充/排序将不可用（其余功能不受影响）。通常是 core 版本或内部路径变了。'
                );
            }
        }
    };
}

/**
 * 载入 core 的一个内部类
 * @param {string} name 导出名，同时也是默认文件名（如 `AutoSortFramework`）
 * @param {string[]} [extraPaths] 额外的候选路径
 * @returns {Promise<Function>} 真实类，或空壳基类（永不为 null，便于直接 `extends`）
 */
export async function loadCoreClass(name, extraPaths = []) {
    const paths = [`${CORE_FEATURES}/${name}.js`, ...extraPaths];

    for (const path of paths) {
        try {
            const mod = await import(/* webpackIgnore: true */ path);
            const cls = mod?.[name];
            if (typeof cls === 'function') return cls;
        } catch {
            /* 路径不存在 / core 未启用 —— 试下一个 */
        }
    }

    // 兜底：万一以后 core 把类挂到公开 API 上
    const apis = [
        globalThis.ui?.BG3HOTBAR?.api,
        globalThis.game?.bg3Hud?.api,
        globalThis.game?.modules?.get?.(CORE_MODULE_ID)?.api
    ];
    for (const api of apis) {
        const cls = api?.[name];
        if (typeof cls === 'function') return cls;
    }

    return makeStub(name);
}

/** 供测试用：清掉"已警告"记录 */
export function resetCoreBridgeWarnings() {
    warned.clear();
}
