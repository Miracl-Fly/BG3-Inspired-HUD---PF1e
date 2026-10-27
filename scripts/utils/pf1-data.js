/**
 * PF1 数据读取层
 *
 * 所有对 actor/item 内部结构的假设都收在这里，方便 PF1 升级（v11 → v12）时只改一处。
 * 取不到的字段一律返回安全默认值，**绝不抛错**——HUD 渲染途中抛错会让整个界面黑掉。
 */

/** 六项属性 */
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** 三豁免 */
export const SAVES = ['fort', 'ref', 'will'];

/** 常用技能（信息面板用） */
export const SHOWCASE_SKILLS = ['per', 'ste', 'acr', 'kna', 'umd'];

const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * 受伤比例（给肖像上的红色蒙层用：红色从底部往上涨）
 * @param {{percent:number, value:number}} hp
 * @returns {number} 0–100，受伤越多越大；0 血时 100
 */
export function getDamagePercent(hp) {
    if (!(hp?.value > 0)) return 100;
    return Math.max(0, Math.min(100, 100 - (Number(hp.percent) || 0)));
}

/**
 * 血条下面那行文字的分段
 *
 * 剩余/最大（红）· 瘀伤（紫）· 虚假生命（白）
 * @param {{value:number, max:number, temp:number, nonlethal:number}} hp
 * @returns {Array<{text:string, cls:string, title:string}>}
 */
export function getHealthSegments(hp) {
    const segments = [
        {
            text: `${hp.value} / ${hp.max}`,
            cls: 'pf1-hp-cur',
            title: `生命值 ${hp.value} / ${hp.max}`
        }
    ];
    if ((hp.nonlethal ?? 0) > 0) {
        segments.push({
            text: `瘀伤 ${hp.nonlethal}`,
            cls: 'pf1-hp-nl',
            title: `瘀伤（非致命伤害）${hp.nonlethal}${
                hp.nonlethal >= hp.value ? ' —— 已达到当前生命值，角色晕眩/昏迷' : ''
            }`
        });
    }
    if ((hp.temp ?? 0) > 0) {
        segments.push({
            text: `+${hp.temp}`,
            cls: 'pf1-hp-temp',
            title: `虚假生命 / 临时生命值 ${hp.temp}`
        });
    }
    return segments;
}

/**
 * 生命值
 * PF1: system.attributes.hp = { value, max, temp, nonlethal, offset, negLevels }
 * @param {Actor} actor
 * @returns {{value:number, max:number, temp:number, nonlethal:number, percent:number, ratio:number}}
 */
export function getHealth(actor) {
    const hp = actor?.system?.attributes?.hp ?? {};
    const max = Math.max(num(hp.max, 1), 1);
    const value = Math.min(num(hp.value, max), max);
    const temp = Math.max(num(hp.temp, 0), 0);
    // 瘀伤（非致命伤害）：PF1 用它判断"是否被打晕"，不会直接从 hp.value 里扣
    const nonlethal = Math.max(num(hp.nonlethal, 0), 0);
    return {
        value,
        max,
        temp,
        nonlethal,
        percent: Math.round((value / max) * 100),
        ratio: value / max
    };
}

/** 护甲等级：PF1 有 normal / flatFooted / touch 三套 */
export function getAC(actor) {
    const ac = actor?.system?.attributes?.ac ?? {};
    return {
        normal: num(ac.normal?.total, 10),
        flatFooted: num(ac.flatFooted?.total, 10),
        touch: num(ac.touch?.total, 10)
    };
}

/** 角色等级（npc 用 CR 兜底） */
export function getLevel(actor) {
    const details = actor?.system?.details ?? {};
    const lvl = num(details.level?.value, 0);
    if (lvl > 0) return lvl;
    return num(details.cr?.total, 0);
}

/** 豁免 */
export function getSaves(actor) {
    const saves = actor?.system?.attributes?.savingThrows ?? {};
    return SAVES.reduce((acc, id) => {
        acc[id] = num(saves[id]?.total, 0);
        return acc;
    }, {});
}

/** 属性调整值 */
export function getAbilityMods(actor) {
    const abilities = actor?.system?.abilities ?? {};
    return ABILITIES.reduce((acc, id) => {
        acc[id] = num(abilities[id]?.mod, 0);
        return acc;
    }, {});
}

/** 技能调整值 */
export function getSkillMod(actor, skillId) {
    return num(actor?.system?.skills?.[skillId]?.mod, 0);
}

/** 先攻 / BAB / CMB / CMD / 速度 */
export function getCombatBasics(actor) {
    const a = actor?.system?.attributes ?? {};
    return {
        init: num(a.init?.total, 0),
        bab: num(a.bab?.total, 0),
        cmb: num(a.cmb?.total, 0),
        cmd: num(a.cmd?.total, 10),
        land: num(a.speed?.land?.total, 0)
    };
}

/**
 * 法术书（PF1 每个施法职业一本）
 * system.attributes.spells.spellbooks = { [bookId]: { class, cl, ability, slots, ... } }
 * 注意：这是普通对象而不是 Collection，用 Object.values 取值。
 * @param {Actor} actor
 * @returns {Array<{id:string, label:string, cl:number, slots:Object}>}
 */
export function getSpellbooks(actor) {
    const books = actor?.system?.attributes?.spells?.spellbooks;
    if (!books || typeof books !== 'object') return [];
    return Object.entries(books)
        .filter(([, book]) => book && typeof book === 'object')
        .map(([id, book]) => {
            const label =
                book.class && typeof book.class === 'string'
                    ? (game.i18n?.localize?.(`PF1.Classes.${book.class}`) === `PF1.Classes.${book.class}`
                        ? book.class
                        : game.i18n.localize(`PF1.Classes.${book.class}`))
                    : (book.label || id);
            return {
                id,
                label,
                cl: num(book.cl, 0),
                ability: book.ability || '',
                slots: book.slots && typeof book.slots === 'object' ? book.slots : {},
                // 自发施法的每日次数挂在 spells.spellN 上（不是 slots）
                spells: book.spells && typeof book.spells === 'object' ? book.spells : {},
                spellPoints: book.spellPoints ?? null,
                // 自发施法（术士/吟游诗人/先知）：次数挂在环位上，不看单法术的 preparation
                spontaneous:
                    book.spontaneous === true || book.spellPreparationMode === 'spontaneous',
                spellPreparationMode: book.spellPreparationMode ?? '',
                inUse: book.inUse !== false
            };
        });
}

/**
 * 找出这个法术属于哪本法术书
 * PF1 里 `item.system.spellbook` 是书名，空字符串表示主书（primary）
 * @param {Item} item
 * @param {Actor} actor
 * @returns {{id:string, spontaneous:boolean, slots:Object}|null}
 */
export function getSpellbookFor(item, actor) {
    const books = getSpellbooks(actor);
    if (!books.length) return null;
    const wanted = String(item?.system?.spellbook || 'primary');
    return (
        books.find((book) => book.id === wanted) ??
        (books.length === 1 ? books[0] : null)
    );
}

/**
 * 某个法术环位的可用/总数（跨所有法术书累加）
 * @param {Actor} actor
 * @param {number} level 0 = 戏法
 * @returns {{available:number, max:number}|null} null 表示这个角色没有该环位
 */
export function getSpellSlotsForLevel(actor, level) {
    const books = getSpellbooks(actor);
    if (!books.length) return null;
    let available = 0;
    let max = 0;
    let found = false;
    for (const book of books) {
        const slot = book.slots?.[String(level)];
        if (!slot) continue;
        const slotMax = num(slot.max, 0);
        if (slotMax <= 0) continue;
        found = true;
        max += slotMax;
        available += Math.max(0, num(slot.value, slotMax));
    }
    return found ? { available, max } : null;
}

/**
 * 法术的"每日次数"（格子上和物品充能用同一个位置显示）
 *
 * PF1 里法术的次数有两种来源：
 *   - **准备施法**（法师/牧师/德鲁伊）：每个法术自己带 `system.preparation = {value, max}`，
 *     每次施放由 `item.addCharges(-1)` 直接扣这个值（见 pf1 的 ItemSpellPF.addCharges）。
 *     `max` = 今天准备了几份，`value` = 还剩几份。**没准备的法术 max 是 0**（放不出来）。
 *   - **自发施法**（术士/吟游诗人/先知）：没有单个法术的计数，次数挂在**环位**上
 *     （`spellbook.spells.spellN.value`），同环法术共享。
 *     这类法术的 `preparation` 也会是 1/1（PF1 拿来标记"已知"），**不能当次数用**，
 *     所以要先看法术书是不是 spontaneous，再决定读哪儿。
 *
 * 以下情况不给数字：`atWill`（随意使用）、戏法（不消耗）、法术点系统（另有一套）。
 *
 * @param {Item} item 法术物品
 * @param {Actor} [actor] 施法者，缺省用 item.actor
 * @returns {{value:number, max:number, prepared:number, kind:'prepared'|'spontaneous'}|null}
 */
/** 是不是真正的法术物品（有 type 或 preparation 字段；冒烟测试里可能只给 level） */
function isSpellItem(item) {
    if (!item) return false;
    if (item.type === 'spell') return true;
    return Boolean(item.system && typeof item.system.preparation === 'object');
}

export function getSpellUses(item, actor) {
    if (item?.type !== 'spell') return null;
    const sys = item.system ?? {};
    if (sys.atWill) return null; // 随意使用，没有次数

    const level = num(sys.level, 0);
    if (level <= 0) return null; // 戏法不消耗环位

    const caster = actor ?? item?.actor ?? null;
    if (getSpellbooks(caster).some((book) => book.spellPoints?.useSystem)) return null; // 法术点制

    const book = getSpellbookFor(item, caster);
    const spontaneous = book?.spontaneous === true;
    const kind = spontaneous ? 'spontaneous' : 'prepared';

    // 1) 有 PF1 自己的算法就直接用 —— 准备/自发/法术点三种情况它都算好了
    //    （ItemSpellPF#getSpellUses：自发读 spells.spellN.value/max，准备读 preparation）
    if (typeof item.getSpellUses === 'function') {
        try {
            const max = Number(item.getSpellUses(true));
            const value = Number(item.getSpellUses(false));
            if (Number.isFinite(max)) {
                if (max <= 0) {
                    // PF1 说 0：没准备 / 没掌握 / 没环位 —— 画个 0 让它置灰
                    return { value: 0, max: 1, prepared: 0, kind };
                }
                return {
                    value: Math.max(0, Math.min(Number.isFinite(value) ? value : max, max)),
                    max,
                    prepared: max,
                    kind
                };
            }
        } catch {
            /* 文档上没有这个方法或抛错，退回自己推 */
        }
    }

    if (!spontaneous) {
        const prep = sys.preparation ?? {};
        const prepMax = num(prep.max, 0);
        const raw = prep.value === null || prep.value === undefined ? prepMax : num(prep.value, prepMax);
        const value = Math.max(0, Math.min(raw, prepMax));

        if (prepMax > 0) {
            return { value, max: prepMax, prepared: prepMax, kind: 'prepared' };
        }
        // 施法者信息在、且这条确实是法术（有 preparation 字段），但没准备：
        // 0 次、置灰（max 给 1 只是为了让格子画出那个 0）
        if (book && isSpellItem(item)) return { value: 0, max: 1, prepared: 0, kind: 'prepared' };
        return null;
    }

    // 自发施法：次数在 book.spells["spell" + level] 上（不是 slots）
    const entry = book?.spells?.[`spell${level}`];
    const entryMax = num(entry?.max, 0);
    if (entryMax > 0) {
        const raw = entry.value === null || entry.value === undefined ? entryMax : num(entry.value, entryMax);
        return {
            value: Math.max(0, Math.min(raw, entryMax)),
            max: entryMax,
            prepared: entryMax,
            kind: 'spontaneous'
        };
    }

    // 老结构/没有 spells 表时的兜底
    const slots = getSpellSlotsForLevel(caster, level);
    if (slots && slots.max > 0) {
        return { value: slots.available, max: slots.max, prepared: slots.max, kind: 'spontaneous' };
    }
    return null;
}

/**
 * 法术是否"还放得出来"（用于格子置灰）
 * @param {Actor} actor
 * @param {Item} item
 * @returns {boolean|undefined} undefined = 判断不了，别置灰
 */
export function isSpellDepleted(actor, item) {
    if (!actor || !item) return undefined;
    const level = num(item.system?.level, 0);
    // 戏法 / 类法术能力不消耗环位
    if (level === 0) return false;
    if (item.system?.atWill) return false;

    // 和格子上显示的是同一份读数：0 就置灰
    const uses = getSpellUses(item, actor);
    if (uses) return uses.value <= 0;

    // 拿不到次数（没有 preparation 字段之类的简化数据）：退回环位判断
    const slots = getSpellSlotsForLevel(actor, level);
    if (!slots) return undefined;
    return slots.available <= 0;
}

/**
 * 物品的"使用次数"（电池/充能/每日次数）
 * PF1: system.uses = { max, value, per, ... }；部分物品还有 system.charges
 *
 * `per: 'single'`（卷轴、药水这类"用一次就没"的东西）：
 * PF1 在物品准备阶段会把 `uses.max` 置成 1，但 `uses.value` 始终是 **null**。
 * 而 `Number(null) === 0`，所以早期直接 `num(uses.value, max)` 会得到 0/1
 * ——格子上就钉着一个"0"的充能。这里显式处理：单次使用 = **1 次充能**，
 * 数量另算（9 张卷轴 = 数量 9 + 充能 1/1）。
 *
 * @param {Item} item
 * @returns {{value:number, max:number}|null}
 */
export function getItemUses(item) {
    const sys = item?.system ?? {};
    const uses = sys.uses;

    if (uses && typeof uses === 'object') {
        // 单次使用：一次就是 1 次
        if (uses.per === 'single') {
            const qty = sys.quantity;
            const available = qty === undefined || qty === null ? 1 : num(qty, 1);
            return { value: available > 0 ? 1 : 0, max: 1 };
        }

        const max = num(uses.max, 0);
        if (max > 0) {
            // value 为 null/undefined 表示"满"，不能走 num（Number(null) 是 0）
            const raw =
                uses.value === null || uses.value === undefined ? max : num(uses.value, max);
            return { value: Math.max(0, Math.min(raw, max)), max };
        }
    }

    const charges = num(sys.charges, 0);
    if (charges > 0) {
        // PF1 的 charges 只有一个当前值，上限看 maxCharges（没有就当作当前值）
        const maxCharges = num(sys.maxCharges, charges);
        return { value: charges, max: Math.max(maxCharges, charges) };
    }
    return null;
}

/**
 * 物品还有没有"实物"（数量 > 0）
 *
 * 法术/专长/职业特性这类没有 `system.quantity` 的物品一律视为有货；
 * 有数量字段且为 0 的（卷轴用完、箭矢打光）不该被自动填充上热键栏。
 *
 * @param {Item} item
 * @returns {boolean}
 */
export function hasStock(item) {
    const qty = item?.system?.quantity;
    if (qty === undefined || qty === null) return true;
    return num(qty, 0) > 0;
}

/** 物品数量（箭矢、药水这类） */
export function getItemQuantity(item) {
    const qty = num(item?.system?.quantity, 0);
    return qty > 1 ? qty : null;
}

/** 角色身上的状态/条件（PF1 v11 用 actor.statuses，回退到 effects） */
export function getStatuses(actor) {
    try {
        if (actor?.statuses?.size) return [...actor.statuses];
    } catch {
        /* ignore */
    }
    try {
        return (actor?.effects?.contents ?? []).filter((e) => !e.disabled).map((e) => e.statuses ?? []).flat();
    } catch {
        return [];
    }
}
