/**
 * PF1 富文本提示框
 *
 * core 的签名：renderer(item, options) → { content, classes?, direction? }
 * item 是 **已解析的文档**（core 自己 fromUuid 之后传进来的），不是格子数据。
 *
 * 这里只做"扫一眼就知道这格是什么"的卡片：名称、类型、关键数值、描述前两行。
 * 不做完整物品卡——按住 Shift 看系统自己的卡片更准。
 */

import { getItemUses, getSpellUses } from './pf1-data.js';

const MODULE_ID = 'bg3-hud-pf1';

/** 「显示施法者等级」设置（读不到就当作关） */
function casterLevelEnabled() {
    try {
        return game.settings.get(MODULE_ID, 'showCasterLevel') === true;
    } catch {
        return false;
    }
}

/** 「显示环数与豁免 DC」设置（读不到就当作开：这是消耗品最重要的两个数） */
function spellInfoEnabled() {
    try {
        return game.settings.get(MODULE_ID, 'showSpellInfo') !== false;
    } catch {
        return true;
    }
}

/**
 * 物品的施法者等级（PF1 的 `system.cl`）。
 * 卷轴/药水/魔杖/法杖/武器/护甲……凡是填了 CL 的都有，不限消耗品。
 * @param {Item} item
 * @returns {number|null}
 */
export function getItemCasterLevel(item) {
    const value = Number(item?.system?.cl);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.trunc(value);
}

/** 会带"法术环数 / 豁免 DC"的消耗品子类型（法杖一个格子里装好几个法术，不猜） */
const SPELL_CONSUMABLE_SUBTYPES = new Set(['scroll', 'potion', 'wand']);

const SAVE_TYPE_LABEL = {
    fort: '强韧',
    ref: '反射',
    will: '意志'
};

/** 公式里的环数标签：10 + 2[法术等级] + 1[施法属性] / 10 + 3[SL] + 1[Casting Ability] */
const SPELL_LEVEL_TERM = /(\d+)\s*\[\s*(?:法术等级|法術等級|Spell\s*Level|SL)\s*\]/i;

/**
 * 解析 PF1 的豁免 DC 公式。
 *
 * 真实数据长这样（world 里抓的）：
 *   10 + 2[法术等级] + 1[施法属性]     → 环 2、DC 13
 *   10 + undefined[Spell Level] + NaN[Spellcasting Ability] → 数据是坏的，认不出
 *   13                                → 直接就是数字
 *
 * 方括号里只是给人看的标签，数字已经写在公式里了，所以把方括号整段删掉再算加减。
 * @param {unknown} raw
 * @returns {{level:number|null, dc:number|null}}
 */
export function parseSaveFormula(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { level: null, dc: null };

    const levelMatch = SPELL_LEVEL_TERM.exec(text);
    const level = levelMatch ? Number(levelMatch[1]) : null;

    // 只剩数字和加减号，才敢照着算；混进 @cl / undefined / NaN 就认输
    const bare = text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    let dc = null;
    if (/^[+\-]?\s*\d+(?:\.\d+)?(?:\s*[+\-]\s*\d+(?:\.\d+)?)*$/.test(bare)) {
        const tokens = bare.match(/[+\-]?\s*\d+(?:\.\d+)?/g) ?? [];
        const sum = tokens.reduce((acc, token) => acc + Number(token.replace(/\s+/g, '')), 0);
        if (Number.isFinite(sum) && sum > 0 && sum < 100) dc = Math.trunc(sum);
    }

    return { level: Number.isFinite(level) && level >= 0 ? level : null, dc };
}

/**
 * 消耗品（卷轴 / 药水 / 魔杖）的法术环数与豁免 DC。
 *
 * PF1 11 把这些信息放在 action 的 `save.dc` 公式里（没有独立的 spellLevel 字段），
 * 一个物品可能有多个 action（heal / spellsave / msak），取第一个能读出数的那条。
 *
 * @param {Item} item
 * @returns {{level:number|null, dc:number|null, saveType:string}|null}
 */
export function getItemSpellInfo(item) {
    if (item?.type !== 'consumable') return null;
    const subType = String(item?.system?.subType ?? '').toLowerCase();
    if (!SPELL_CONSUMABLE_SUBTYPES.has(subType)) return null;

    let level = null;
    let dc = null;
    let saveType = '';

    const actions = item?.system?.actions;
    for (const action of Array.isArray(actions) ? actions : []) {
        // action 是 DataModel：正常直接读 .save，读不到就退化成 toObject()
        const save = action?.save ?? action?.toObject?.()?.save ?? null;
        const parsed = parseSaveFormula(save?.dc);
        if (level === null && parsed.level !== null) level = parsed.level;
        if (dc === null && parsed.dc !== null) {
            dc = parsed.dc;
            saveType = String(save?.type ?? '');
        }
    }

    // 老数据/手工填的：真有 spellLevel 字段就用它
    if (level === null) {
        const raw = Number(item?.system?.spellLevel);
        if (Number.isFinite(raw) && raw >= 0) level = Math.trunc(raw);
    }

    // 只知道环数、没有豁免（比如无豁免的法术）：按 PF1 卷轴/魔杖的规则补一个 DC
    // 10 + 环数 + 最低施法属性调整值（= floor(环数/2)）
    if (dc === null && level !== null) dc = 10 + level + Math.floor(level / 2);

    if (level === null && dc === null) return null;
    return { level, dc, saveType };
}

const TYPE_LABEL = {
    weapon: '武器',
    attack: '天生攻击',
    spell: '法术',
    feat: '专长',
    buff: '增益',
    consumable: '消耗品',
    equipment: '装备',
    loot: '战利品',
    class: '职业',
    race: '种族',
    container: '容器',
    implant: '植入体'
};

/** 去掉 HTML 标签、压缩空白、截断 */
function plain(html, max = 260) {
    if (!html) return '';
    const text = String(html)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 数值行：标签 + 值，值为空就不显示 */
function row(label, value) {
    if (value === undefined || value === null || value === '') return '';
    return `<div class="pf1-tip-row"><span class="pf1-tip-label">${label}</span><span class="pf1-tip-value">${value}</span></div>`;
}

/**
 * 武器的关键数值
 * @param {Item} item
 */
function weaponRows(item) {
    const sys = item.system ?? {};
    const rows = [];

    const atk = sys.attackBonus;
    if (atk !== undefined && atk !== null && atk !== '') {
        const n = Number(atk);
        rows.push(row('攻击', `${n >= 0 ? '+' : ''}${Number.isFinite(n) ? n : atk}`));
    }

    const parts = sys.damage?.parts;
    if (Array.isArray(parts) && parts.length) {
        const dmg = parts
            .map((p) => {
                const formula = Array.isArray(p) ? p[0] : p?.formula;
                const types = Array.isArray(p?.[1]) ? p[1] : [];
                return `${formula ?? ''}${types.length ? ` (${types.join('/')})` : ''}`;
            })
            .filter(Boolean)
            .join(' + ');
        if (dmg) rows.push(row('伤害', dmg));
    }

    if (sys.critRange) rows.push(row('暴击', `${sys.critRange}${sys.critMult ? ` ×${sys.critMult}` : ''}`));
    if (sys.enh) rows.push(row('增强', `+${sys.enh}`));

    const props = sys.properties;
    if (Array.isArray(props) && props.length) {
        rows.push(row('特性', props.map((p) => game.i18n?.localize?.(`PF1.WeaponProperties.${p}`) || p).join('、')));
    }

    return rows.join('');
}

/**
 * 法术的关键数值
 * @param {Item} item
 */
function spellRows(item) {
    const sys = item.system ?? {};
    const rows = [];

    const lvl = Number(sys.level);
    rows.push(row('环位', Number.isFinite(lvl) ? (lvl === 0 ? '戏法' : `${lvl} 环`) : ''));

    if (sys.school) rows.push(row('学派', game.i18n?.localize?.(`PF1.SpellSchools.${sys.school}`) || sys.school));
    if (sys.castingTime) rows.push(row('施法时间', sys.castingTime));
    if (sys.range) rows.push(row('距离', sys.range));
    if (sys.target) rows.push(row('目标', sys.target));
    if (sys.duration) rows.push(row('持续', sys.duration));
    if (sys.save?.type) rows.push(row('豁免', sys.save.type));
    if (sys.sr === true) rows.push(row('法术抗力', '有'));

    return rows.join('');
}

/** 使用次数（和格子上显示的是同一份数据） */
function usesRow(item) {
    // 法术：准备施法看已准备数量，自发施法看该环位的每日环位
    if (item?.type === 'spell') {
        if (item.system?.atWill) return row('次数', '随意使用');
        const spellUses = getSpellUses(item, item.actor);
        if (!spellUses) return '';
        if (spellUses.kind === 'spontaneous') {
            return row('环位', `剩 ${spellUses.value} / 共 ${spellUses.max}`);
        }
        if (spellUses.prepared <= 0) return row('准备', '未准备');
        return row('准备', `${spellUses.value} / ${spellUses.prepared}`);
    }

    const uses = getItemUses(item);
    if (uses) {
        const label = item.system?.uses?.per === 'single' ? '使用' : '次数';
        return row(label, `${uses.value} / ${uses.max}`);
    }
    const charges = Number(item.system?.charges);
    if (Number.isFinite(charges) && charges > 0) return row('充能', String(charges));
    return '';
}

/**
 * 渲染提示框内容
 * @param {Item} item
 * @param {Object} [options]
 * @returns {Promise<{content:string, classes:string[], direction?:string}>}
 */
export async function renderPf1Tooltip(item, options = {}) {
    if (!item) return { content: '', classes: ['pf1-tooltip'] };

    const typeLabel = TYPE_LABEL[item.type] ?? item.type;
    const cl = casterLevelEnabled() ? getItemCasterLevel(item) : null;
    const spell = spellInfoEnabled() ? getItemSpellInfo(item) : null;
    const desc = plain(item.system?.description?.value, options.descriptionLength ?? 260);

    let rows = '';
    if (item.type === 'weapon' || item.type === 'attack') rows = weaponRows(item);
    else if (item.type === 'spell') rows = spellRows(item);
    rows += usesRow(item);

    const sub = [typeLabel];
    if (item.type === 'spell' && item.system?.level !== undefined) {
        const lvl = Number(item.system.level);
        sub.push(lvl === 0 ? '戏法' : `${lvl} 环`);
    }
    if (item.system?.equipped === true) sub.push('已装备');

    // 标题行右侧的小徽章：CL / 环数 / DC。一个都没有就不留占位
    const badges = [];
    if (cl) badges.push(`<div class="pf1-tip-cl" title="施法者等级">CL ${cl}</div>`);
    if (spell?.level !== null && spell?.level !== undefined) {
        const label = spell.level === 0 ? '戏法' : `${spell.level} 环`;
        badges.push(`<div class="pf1-tip-chip" title="法术环数">${label}</div>`);
    }
    if (spell?.dc !== null && spell?.dc !== undefined) {
        const saveName = SAVE_TYPE_LABEL[spell.saveType] ?? '';
        const title = saveName ? `豁免 DC（${saveName}）` : '豁免 DC';
        badges.push(`<div class="pf1-tip-chip pf1-tip-dc" title="${title}">DC ${spell.dc}</div>`);
    }
    const badgeHtml = badges.length ? `<div class="pf1-tip-badges">${badges.join('')}</div>` : '';

    const content = `
        <div class="pf1-tip">
            <div class="pf1-tip-head">
                <img class="pf1-tip-img" src="${item.img ?? 'icons/svg/item-bag.svg'}" alt="" />
                <div class="pf1-tip-title">
                    <div class="pf1-tip-name">${item.name ?? ''}</div>
                    <div class="pf1-tip-type">${sub.join(' · ')}</div>
                </div>
                ${badgeHtml}
            </div>
            ${rows ? `<div class="pf1-tip-rows">${rows}</div>` : ''}
            ${desc ? `<div class="pf1-tip-desc">${desc}</div>` : ''}
        </div>`;

    return {
        content,
        classes: ['pf1-tooltip', `pf1-tooltip-${item.type}`],
        direction: options.direction ?? 'UP'
    };
}
