/**
 * BG3 HUD — Pathfinder 1e 适配器（bg3-hud-pf1）
 *
 * 与 core 的契约（core 0.8.0 会调用这些）：
 *   registerNamedHudParts({ portrait, passives, weaponSet, filter, characterInfo, rest })
 *   registerAdapter(adapter)  →  adapter 需要提供：
 *     MODULE_ID / systemId / name
 *     isCompatible / isPlayerCharacter / getDisplaySettings / getPortraitDataDefaults
 *     transformItemToCellData / onCellClick / decorateCellElement
 *     shouldAutoAddItem / shouldBlockFromHotbar / resolveHotbarMembershipOnItemUpdate
 *     isHeldItem / isTwoHanded（武器组用）
 *     autoPopulate（可选，自动填充）
 *   registerTooltipRenderer(systemId, renderer)  →  富文本提示框
 *
 * 刻意不实现的：targetingRules / resolveNotice / activeEffects 容器（PF1 用 core 默认的就行）。
 */

import { registerSettings } from './utils/settings.js';
import { Pf1AutoPopulate } from './features/Pf1AutoPopulate.js';
import { Pf1AutoSort } from './features/Pf1AutoSort.js';
import { createPf1PortraitContainer } from './components/containers/Pf1PortraitContainer.js';
import { createPf1InfoContainer } from './components/containers/Pf1InfoContainer.js';
import { createPf1FilterContainer } from './components/containers/Pf1FilterContainer.js';
import { createPf1PassivesContainer } from './components/containers/Pf1PassivesContainer.js';
import { createPf1WeaponSetContainer } from './components/containers/Pf1WeaponSetContainer.js';
import { createPf1MenuBuilder } from './features/Pf1MenuBuilder.js';
import { renderPf1Tooltip } from './utils/tooltipRenderer.js';
import { applyCoreTranslationOverrides } from './utils/i18n-overrides.js';
import {
    installErrorCapture,
    setApi,
    runDiagnostics,
    copyDiagnostics,
    collectDiagnostics,
    getCapturedErrors,
    clearCapturedErrors
} from './utils/diagnostics.js';
import { getItemUses, getItemQuantity, getSpellUses, hasStock, isSpellDepleted } from './utils/pf1-data.js';
import { useItem, rollFromItem } from './features/Pf1ItemUse.js';
import { syncActorTint } from './utils/tokenTint.js';

const MODULE_ID = 'bg3-hud-pf1';

const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
const warn = (...args) => console.warn(`${MODULE_ID} |`, ...args);

/* ========================================================================== */
/*  初始化                                                                     */
/* ========================================================================== */

Hooks.once('init', () => {
    registerSettings();
    installErrorCapture();
    const patched = applyCoreTranslationOverrides();
    log('设置已注册');
    if (patched > 0) log(`已补 ${patched} 条 core 缺失的中文文案`);
});

Hooks.once('ready', () => {
    // 让用户可以在控制台直接 `game.bg3HudPf1.diagnose()` 拿一份可复制的诊断
    game.bg3HudPf1 = {
        version: '0.8.13',
        diagnose: runDiagnostics,
        snapshot: collectDiagnostics,
        copy: copyDiagnostics,
        errors: getCapturedErrors,
        clearErrors: clearCapturedErrors
    };
    log('自诊断已挂到 game.bg3HudPf1（输入 game.bg3HudPf1.diagnose()）');
});

Hooks.on('bg3HudReady', async (BG3HUD_API) => {
    if (game.system.id !== 'pf1') {
        log(`当前系统是 ${game.system.id}，不是 pf1，跳过注册`);
        return;
    }
    if (!BG3HUD_API) {
        warn('core 的 bg3HudReady 没有带 API，跳过注册');
        return;
    }

    setApi(BG3HUD_API);
    log('开始注册 PF1 组件');

    // 每个容器单独兜住错误：一个坏掉不应该让整个 HUD 都不出来
    const safe = async (name, factory) => {
        try {
            return await factory();
        } catch (error) {
            warn(`创建 ${name} 容器失败，该部件将被跳过`, error);
            return null;
        }
    };

    const [portrait, characterInfo, filter, passives, weaponSet, menuBuilder] = await Promise.all([
        safe('portrait', createPf1PortraitContainer),
        safe('characterInfo', createPf1InfoContainer),
        safe('filter', createPf1FilterContainer),
        safe('passives', createPf1PassivesContainer),
        safe('weaponSet', createPf1WeaponSetContainer),
        safe('menuBuilder', createPf1MenuBuilder)
    ]);

    BG3HUD_API.registerNamedHudParts({
        portrait,
        characterInfo,
        filter,
        passives,
        weaponSet,
        rest: getPf1Rests
    });

    const adapter = new Pf1Adapter();
    BG3HUD_API.registerAdapter(adapter);

    // 右键菜单：肖像（角色卡/先攻/调血）、控制按钮（core 的布局项 + 自动填充配置 + 诊断）
    if (menuBuilder) {
        try {
            BG3HUD_API.registerMenuBuilder?.(game.system.id, menuBuilder, { adapter });
        } catch (error) {
            warn('注册 menuBuilder 失败（右键菜单会回落成 core 默认）', error);
        }
    }

    // 富文本提示框：鼠标停在格子上时显示 PF1 物品卡摘要
    try {
        BG3HUD_API.registerTooltipRenderer(game.system.id, renderPf1Tooltip);
    } catch (error) {
        warn('注册 tooltip 渲染器失败（不影响 HUD 本身）', error);
    }

    Hooks.call('bg3HudRegistrationComplete');
    log('注册完成');

    registerTokenTintHooks();
});

/* ========================================================================== */
/*  token 按血量染色                                                           */
/* ========================================================================== */

/**
 * 让"血量 → token 颜色"跟 BG3 网页一样，不依赖 HUD 是否开在这个 token 上
 *
 * HUD 自己也会同步（肖像容器里），但只有当前 token 会走那条路；
 * 这里补两个钩子，让视野里的所有 token（含队友）都跟着血量变色。
 */
function registerTokenTintHooks() {
    // 血量（含瘀伤）变化就同步颜色
    Hooks.on('updateActor', (actor, changes) => {
        if (!changes?.system?.attributes?.hp) return;
        void syncActorTint(actor).catch(() => {});
    });

    // 新 token 落地时按当前血量决定初始颜色（比如放到地图上时已经半血）
    Hooks.on('createToken', (tokenDoc) => {
        const token = tokenDoc?.object;
        if (!token) return;
        void syncActorTint(token.actor, token).catch(() => {});
    });

    // 重新加载 / 切场景后，把地图上已经带伤（或已昏迷）的 token 补上颜色
    Hooks.on('canvasReady', () => {
        for (const token of canvas?.tokens?.placeables ?? []) {
            void syncActorTint(token.actor, token).catch(() => {});
        }
    });
}

/* ========================================================================== */
/*  休整按钮                                                                   */
/* ========================================================================== */

/**
 * 休整按钮
 *
 * PF1 v11 的休整只有 ActorRestDialog 一个入口，但**它没有挂到 `pf1.applications` 上**
 * （那个命名空间里是 ActionSelector/AttackDialog 等，不含 ActorRestDialog；
 *   ActorRestDialog 只在 applications/actor/ 的内部命名空间里，外部拿不到类）。
 *
 * 所以按四级兜底，前三级都直接给出"休整"效果：
 *   1) 已经开着的休整窗口 → 提到最前面
 *   2) 类被挂在某处（pf1.applications / CONFIG.PF1 / globalThis）→ new 一个
 *   3) 借道角色卡自己的 `_onRest()` —— 它在闭包里能拿到 ActorRestDialog，
 *      而且会尊重系统设置里的"跳过确认"（pf1.documents.settings.getSkipActionPrompt()）
 *   4) 实在开不出窗口就直接 `actor.performRest({ verbose: true })`
 * 只有全失败才打开角色卡（并 warn 说明原因）
 *
 * 按钮形状必须与 core 一致：{ key, classes, icon, label, tooltip, tooltipDirection, visible, onClick }
 * @param {{actor: Actor, token: Token}} ctx
 * @returns {Array<Object>}
 */
function getPf1Rests({ actor } = {}) {
    if (!actor) return [];

    const L = (key, fallback) => {
        const text = game.i18n?.localize?.(`${MODULE_ID}.Rest.${key}`);
        return text && text !== `${MODULE_ID}.Rest.${key}` ? text : fallback;
    };

    return [
        {
            key: 'rest',
            classes: ['rest-button'],
            icon: 'fas fa-bed',
            label: L('Label', '休整'),
            tooltip: L('Hint', '完成一次休息（恢复生命、法术位与每日能力）'),
            tooltipDirection: 'LEFT',
            visible: () => !game.combat?.started,
            onClick: async () => {
                const opened = await openPf1RestDialog(actor);
                if (!opened) {
                    warn('打不开 PF1 的休整窗口，也没有 performRest()，改为打开角色卡');
                    actor.sheet?.render(true);
                }
            }
        },
        {
            key: 'sheet',
            classes: ['rest-button', 'sheet-button'],
            icon: 'fas fa-address-card',
            label: L('OpenSheet', '角色卡'),
            tooltip: L('OpenSheetHint', '打开 PF1 角色卡'),
            tooltipDirection: 'LEFT',
            onClick: () => actor.sheet?.render(true)
        }
    ];
}

/**
 * 找到 PF1 的 ActorRestDialog 类（不同版本挂的位置不一样）
 * @returns {Function|null}
 */
function findRestDialogClass() {
    const candidates = [
        globalThis.pf1?.applications?.ActorRestDialog,
        globalThis.pf1?.applications?.actor?.ActorRestDialog,
        game.pf1?.applications?.ActorRestDialog,
        globalThis.CONFIG?.PF1?.applications?.ActorRestDialog,
        globalThis.ActorRestDialog
    ];
    return candidates.find((c) => typeof c === 'function') ?? null;
}

/**
 * 打开 PF1 的休整窗口（或直接休整）
 * @param {Actor} actor
 * @returns {Promise<boolean>} 是否真的触发了休整
 */
async function openPf1RestDialog(actor) {
    if (!actor) return false;

    // 1) 已经开着的休整窗口：提最前，别开第二个
    try {
        const existing = Object.values(actor.apps ?? {}).find(
            (app) => app?.constructor?.name === 'ActorRestDialog'
        );
        if (existing) {
            existing.render?.(true);
            existing.bringToFront?.();
            return true;
        }
    } catch {
        /* ignore */
    }

    // 2) 类能找到就自己 new
    const RestDialog = findRestDialogClass();
    if (RestDialog) {
        try {
            new RestDialog({ document: actor }).render({ force: true });
            return true;
        } catch (error) {
            warn('new ActorRestDialog() 失败，改用角色卡的 _onRest()', error);
        }
    }

    // 3) 借道角色卡：PF1 自己的 _onRest 在闭包里能拿到 ActorRestDialog
    try {
        const sheet = actor.sheet;
        const onRest = sheet?._onRest ?? sheet?.constructor?.prototype?._onRest;
        if (typeof onRest === 'function') {
            // 造一个最小事件对象，够 _onRest 用（它只调 preventDefault / 读 currentTarget）
            const fakeEvent = { preventDefault() {}, currentTarget: { disabled: false } };
            await onRest.call(sheet, fakeEvent);
            return true;
        }
    } catch (error) {
        warn('角色卡的 _onRest() 调用失败，改用 performRest()', error);
    }

    // 4) 直接休整（没有窗口，但确实是"休息"而不是"看角色卡"）
    if (typeof actor.performRest === 'function') {
        try {
            await actor.performRest({ verbose: true });
            return true;
        } catch (error) {
            warn('performRest() 失败', error);
        }
    }

    return false;
}

/* ========================================================================== */
/*  适配器                                                                     */
/* ========================================================================== */

class Pf1Adapter {
    constructor() {
        this.MODULE_ID = MODULE_ID;
        this.systemId = 'pf1';
        this.name = 'Pathfinder 1e Adapter';

        this.autoPopulate = new Pf1AutoPopulate();
        this.autoSort = new Pf1AutoSort();
        // 让自动填充和"手动排序按钮"用同一套顺序，不然填完再点排序会跳一下
        this.autoPopulate.setAutoSort(this.autoSort);
        log('适配器已创建');
    }

    /* ── 身份 / 判定 ─────────────────────────────────────── */

    isCompatible(actor) {
        if (!actor) return false;
        if (actor.type === 'group' && game.settings.get(MODULE_ID, 'ignoreGroupActors')) return false;
        return ['character', 'npc', 'haunt', 'trap', 'vehicle'].includes(actor.type);
    }

    isPlayerCharacter(actor) {
        if (!actor) return false;
        return actor.type === 'character' || !!actor.hasPlayerOwner;
    }

    getDisplaySettings() {
        return {
            showItemNames: game.settings.get(MODULE_ID, 'showItemNames'),
            showItemUses: game.settings.get(MODULE_ID, 'showItemUses')
        };
    }

    /**
     * 肖像上的默认数据徽章（用户没配过时用这几个）
     * PF1 的路径：AC / 速度 / BAB
     */
    getPortraitDataDefaults() {
        return [
            { path: 'system.attributes.ac.normal.total', icon: 'fas fa-shield-alt', color: '#4a90d9' },
            { path: 'system.attributes.speed.land.total', icon: 'fas fa-running', color: '#2ecc71' },
            { path: 'system.attributes.bab.total', icon: 'fas fa-crosshairs', color: '#e67e22' },
            { path: '', icon: '', color: '#ffffff' },
            { path: '', icon: '', color: '#ffffff' },
            { path: '', icon: '', color: '#ffffff' }
        ];
    }

    /* ── 物品 → 格子 ─────────────────────────────────────── */

    /**
     * 把一个 Item 变成格子数据
     * @param {Item} item
     * @returns {Promise<Object|null>}
     */
    async transformItemToCellData(item) {
        if (!item) return null;

        const data = {
            uuid: item.uuid,
            name: item.name,
            img: item.img,
            type: 'Item',
            itemType: item.type
        };

        const uses = getItemUses(item);
        if (uses) data.uses = uses;

        const qty = getItemQuantity(item);
        if (qty) data.quantity = qty;

        if (item.type === 'spell') {
            data.spellLevel = Number(item.system?.level) || 0;

            // 每日法术次数：右上角 = 剩余，左上角 = 准备了几份
            // 准备施法读 preparation，自发施法读该环位剩余环位
            const spellUses = getSpellUses(item, item.actor);
            if (spellUses) {
                data.uses = { value: spellUses.value, max: spellUses.max };
                // 只有准备施法才有"准备了几份"这个概念；core 只在数值 > 1 时才画左上角
                if (spellUses.kind === 'prepared' && spellUses.prepared > 0) {
                    data.quantity = spellUses.prepared;
                }
            }

            const depleted = isSpellDepleted(item.actor, item);
            if (depleted !== undefined) data.depleted = depleted;
        }

        if (item.type === 'consumable') {
            data.subType = item.system?.subType ?? '';
        }

        // 专长类（含职业特性/种族特性/背景特性）：PF1 用 system.subType 区分，
        // 存下来给过滤器和自动填充的子类型匹配用
        if (item.type === 'feat') {
            data.subType = item.system?.subType ?? 'feat';
        }

        // 双手武器：PF1 用 system.held / hand 标记，先只标记出来，武器组以后再用
        if (item.type === 'weapon') {
            data.two = item.system?.held === '2h';
        }

        return data;
    }

    /**
     * 拖进来一个东西（角色卡上的物品、宏等）
     * 返回 null 让 core 走默认流程（它自己会调 transformItemToCellData）
     */
    async resolveExternalDragData() {
        return null;
    }

    /* ── 交互 ───────────────────────────────────────────── */

    /**
     * 左键点格子 = 使用
     * @param {GridCell} cell
     * @param {MouseEvent} event
     */
    async onCellClick(cell, event) {
        const data = cell?.data;
        if (!data?.uuid) return;

        // 右键菜单里"投攻击/投伤害"会带 rollMode
        if (data.rollMode === 'attack' || data.rollMode === 'damage') {
            const item = await this._resolveItem(data.uuid);
            await rollFromItem(item, data.rollMode, event);
            return;
        }

        await useItem(data.uuid, event);
    }

    /**
     * @param {string} uuid
     * @returns {Promise<Item|null>}
     */
    async _resolveItem(uuid) {
        try {
            return await fromUuid(uuid);
        } catch {
            return null;
        }
    }

    /**
     * 右键格子时 core 会先问适配器要菜单项（SlotContextMenu._buildMenuItems）
     * @param {GridCell} cell
     * @param {GridContainer} [_container]
     * @returns {Promise<Array<{label:string, icon:string, onClick:Function}>>}
     */
    async getCellMenuItems(cell, _container) {
        const data = cell?.data;
        if (!data?.uuid) return [];

        const item = await this._resolveItem(data.uuid);
        if (!item) return [];

        const t = (key) => game.i18n.localize(`${MODULE_ID}.CellMenu.${key}`);
        const menu = [];

        // 武器 / 天生攻击：攻击与伤害分开投，方便 GM 只投伤害或者只投命中
        if (item.type === 'weapon' || item.type === 'attack') {
            menu.push({
                label: t('Attack'),
                icon: 'fas fa-sword',
                onClick: () => rollFromItem(item, 'attack')
            });
            menu.push({
                label: t('Damage'),
                icon: 'fas fa-dice-d20',
                onClick: () => rollFromItem(item, 'damage')
            });
        }

        // 武器与装备：装备/卸下（真的改 system.equipped，和武器组用的是同一个字段）
        if (item.type === 'weapon' || item.type === 'equipment') {
            const equipped = Boolean(item.system?.equipped);
            menu.push({
                label: equipped ? t('Unequip') : t('Equip'),
                icon: 'fas fa-shield-alt',
                onClick: () => item.update({ 'system.equipped': !equipped })
            });
        }

        if (item.type === 'spell') {
            menu.push({
                label: t('Cast'),
                icon: 'fas fa-hat-wizard',
                onClick: () => useItem(item.uuid)
            });

            // 只有"需要准备"的法术书才有这个开关，自发施法/天生法术不显示
            const prepared = item.system?.preparation?.prepared;
            if (prepared !== undefined) {
                menu.push({
                    label: prepared ? t('Unprepare') : t('Prepare'),
                    icon: 'fas fa-star',
                    onClick: () => item.update({ 'system.preparation.prepared': !prepared })
                });
            }
        }

        if (item.type === 'consumable' || item.type === 'feat' || item.type === 'buff') {
            menu.push({
                label: t('Use'),
                icon: 'fas fa-hand-fist',
                onClick: () => useItem(item.uuid)
            });
        }

        return menu;
    }

    /**
     * 打开容器格子时，core 会要这个容器里到底装了什么
     *
     * PF1 把"东西在哪个容器里"记在子物品的 `flags.pf1.containerItem` 上
     * （不是 system 里），所以按这个字段反查。
     *
     * @param {Item} containerItem
     * @param {Actor} [actor]
     * @returns {Promise<{rows:number, cols:number, items:Object}>}
     */
    async getContainerContents(containerItem, actor) {
        const grid = { rows: 3, cols: 5, items: {} };
        const owner = containerItem?.actor ?? actor;
        const containerId = containerItem?.id;

        if (!containerId || !owner?.items) return grid;

        const all = owner.items.contents ?? [...owner.items];
        const inside = all.filter((item) => {
            const flags = item.flags?.pf1 ?? {};
            return flags.containerItem === containerId || flags.containerId === containerId;
        });

        let index = 0;
        for (const item of inside) {
            if (index >= grid.rows * grid.cols) break;
            const cell = await this.transformItemToCellData(item);
            if (!cell) continue;
            const row = Math.floor(index / grid.cols);
            const col = index % grid.cols;
            grid.items[`${col}-${row}`] = cell;
            index++;
        }

        return grid;
    }

    /* ── 自动加/不加 ─────────────────────────────────────── */

    /**
     * 新建物品时要不要自动进热键栏
     * @param {Item} item
     */
    shouldAutoAddItem(item) {
        if (!item) return false;
        if (this.shouldBlockFromHotbar(item)) return false;
        // 数量为 0 的（卷轴用完、箭矢打光）没有实物，别自动占格
        if (!hasStock(item)) return false;
        // 有次数的、武器、法术、带动作的专长 —— 这些都值得占一格
        if (item.type === 'spell' || item.type === 'weapon' || item.type === 'buff') return true;
        if (getItemUses(item)) return true;
        const actions = item.system?.actions;
        return Array.isArray(actions) && actions.length > 0;
    }

    /**
     * 永远不该出现在热键栏的物品
     * @param {Item} item
     */
    shouldBlockFromHotbar(item) {
        if (!item) return true;
        return ['class', 'race', 'loot', 'container', 'kit', 'material'].includes(item.type);
    }

    /**
     * 物品被更新时，要不要把它从热键栏里加/删
     * PF1 的准备法术不会改变"能不能用"，所以这里不做成员变更；返回 null 表示不动。
     */
    resolveHotbarMembershipOnItemUpdate() {
        return null;
    }

    /* ── 其它偶发数据（PF1 没有对应概念，返回 null 让 core 走默认） ── */

    /**
     * PF1 没有 dnd5e 那种 activity 文档
     * @returns {null}
     */
    transformActivityToCellData() {
        return null;
    }

    /**
     * PF1 也没有独立的 action 文档（动作记在 system.actions 里，属于物品本身）
     * @returns {null}
     */
    transformActionToCellData() {
        return null;
    }

    /**
     * 这个格子是不是"容器"（背包、次元袋之类，点开是物品列表而不是使用）
     * @param {Object} cellData
     * @returns {Promise<boolean>}
     */
    async isContainer(cellData) {
        if (!cellData) return false;
        const type = cellData.itemType;
        if (type === 'container') return true;
        if (type && type !== 'loot') return false;

        const item = cellData.uuid ? await this._resolveItem(cellData.uuid) : null;
        if (!item) return false;
        if (item.type === 'container') return true;
        // PF1 的战利品/装备也可能是"带内容的容器"
        return Boolean(item.system?.container) || Boolean(item.system?.containerId);
    }

    /* ── 变更提示（决定更新后刷新哪些部件） ─────────────── */

    /**
     * 把一次 updateActor 的 changes 映射成"该刷新什么"
     * @param {Object} changes
     * @param {Actor} [actor]
     * @returns {{fills:string[], extras:string[], cells?:'all'|{parked:string[]}}}
     */
    resolveNotice(changes = {}) {
        const fills = new Set();
        const system = changes?.system ?? {};
        let cells;

        // 血变了 → 肖像生命条
        if (system.attributes?.hp !== undefined) fills.add('portrait:vitals');

        // 防御/属性/技能变了 → 信息面板
        if (
            system.attributes?.ac !== undefined ||
            system.attributes?.savingThrows !== undefined ||
            system.attributes?.bab !== undefined ||
            system.attributes?.cmb !== undefined ||
            system.attributes?.cmd !== undefined ||
            system.attributes?.init !== undefined ||
            system.attributes?.speed !== undefined ||
            system.abilities !== undefined ||
            system.skills !== undefined ||
            system.details !== undefined
        ) {
            fills.add('characterInfo');
        }

        // 法术位变了 → 法术格子的置灰状态要重算
        if (system.attributes?.spells !== undefined) {
            fills.add('characterInfo');
            cells = 'all';
        }

        // 状态/条件变了 → 效果图标
        if (system.attributes?.conditions !== undefined || changes.effects !== undefined) {
            fills.add('activeEffects');
        }

        // 物品栏整体变动 → 全部格子重算
        if (changes.items !== undefined) cells = 'all';

        return { fills: [...fills], extras: [], cells };
    }

    /* ── token 创建后的收尾 ─────────────────────────────── */

    /**
     * 被动条自动填充
     *
     * PF1 这边不需要"选择哪些被动"：Pf1PassivesContainer 默认把所有常驻 buff 与
     * 无动作专长都显示出来，没有要持久化的选择，所以这里是个明确的 no-op。
     * 留着它是因为 core 用 `typeof === 'function'` 判断，实现了就能被未来的选择逻辑复用。
     * @param {Actor} actor
     * @param {TokenDocument} token
     */
    async autoPopulatePassives(actor, token) {
        log(`被动条：${actor?.name ?? '?'} 使用默认规则（常驻 buff + 无动作专长）`);
    }

    /**
     * 自动填充完成后的收尾
     * @param {Actor} actor
     * @param {Object} persistenceManager
     */
    async onTokenCreationComplete(actor, persistenceManager) {
        const state = persistenceManager?.state;
        const filled = (state?.hotbar?.grids ?? []).reduce(
            (sum, grid) => sum + Object.keys(grid?.items ?? {}).length,
            0
        );
        log(`自动填充完成：${actor?.name ?? '?'} 共 ${filled} 格`);
    }

    /* ── 武器组判定 ─────────────────────────────────────── */

    /**
     * 这个格子算不算"拿在手上"
     * 武器组的 2 个格子只接受手持物；其它物品拖上去 core 会拒绝。
     * @param {Object} cell 格子数据
     * @returns {boolean}
     */
    isHeldItem(cell) {
        if (!cell) return false;
        const type = cell.itemType;
        if (!type) return true; // 拿不到类型就别挡，交给 core 自己判断
        return ['weapon', 'equipment', 'shield', 'attack', 'loot'].includes(type);
    }

    /**
     * 双手武器（占两个手，副手格要锁住）
     * @param {Object} cell
     * @returns {boolean}
     */
    isTwoHanded(cell) {
        if (!cell) return false;
        if (cell.two === true) return true;
        const handed = cell.itemType === 'weapon' ? cell.hands : undefined;
        return handed === 2 || handed === '2';
    }

    /* ── 格子装饰（给过滤器用） ─────────────────────────── */

    /**
     * 往格子 DOM 上写 dataset
     *
     * 注意：core 的过滤器 matchesFilter(filter, cell) 收到的是 **DOM 元素**，
     * 所以 dataset 的键名必须和过滤器实现约定一致（itemType / level），
     * 不能用自定义前缀，否则过滤器永远匹配不上。
     *
     * @param {HTMLElement} cellElement
     * @param {Object} cellData
     */
    async decorateCellElement(cellElement, cellData) {
        if (!cellElement || !cellData) return;

        let itemType = cellData.itemType ?? '';
        let spellLevel = cellData.spellLevel;

        // 格子数据里没有类型时，去文档上取（拖拽进来的旧格子常见）
        if ((!itemType || spellLevel === undefined) && cellData.uuid) {
            const item = await this._resolveItem(cellData.uuid);
            if (item) {
                itemType = itemType || item.type;
                if (spellLevel === undefined && item.type === 'spell') {
                    spellLevel = Number(item.system?.level) || 0;
                }
            }
        }

        cellElement.dataset.itemType = itemType;
        if (spellLevel !== undefined) cellElement.dataset.level = String(spellLevel);

        if (cellData.subType) cellElement.dataset.subType = cellData.subType;
    }
}
