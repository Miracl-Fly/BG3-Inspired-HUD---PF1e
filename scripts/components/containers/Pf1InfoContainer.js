/**
 * PF1 信息面板（肖像上方那颗 d20 按钮弹出的滑板）
 *
 * 内容：六项属性 / 三豁免 / 几个常用技能 / 法术位一览。
 * 每行都能点，点了就投（技能走 actor.rollSkill，豁免走 actor.rollSavingThrow）。
 *
 * 这是"少点几次角色卡"的快捷面板，不是完整角色卡——复杂的东西还是开 sheet。
 */

import {
    ABILITIES,
    SAVES,
    SHOWCASE_SKILLS,
    getHealth,
    getAC,
    getLevel,
    getSaves,
    getAbilityMods,
    getSkillMod,
    getCombatBasics,
    getSpellbooks
} from '../../utils/pf1-data.js';
import { rollAbility, rollSave, rollSkill, rollInitiative } from '../../features/Pf1ItemUse.js';

/**
 * 取本地化文本，取不到就用兜底值。
 * PF1 的键是驼峰式（PF1.AbilityShortStr / PF1.SavingThrowFort / PF1.SkillPer），
 * 不是 `PF1.AbilityShort.str` 这种，写错了不会报错、只会显示原始键名，所以必须兜底。
 * @param {string[]} keys 依次尝试的键
 * @param {string} fallback
 * @returns {string}
 */
function loc(keys, fallback) {
    for (const key of keys) {
        const text = game.i18n?.localize?.(key);
        if (text && text !== key) return text;
    }
    return fallback;
}

const cap = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);

export async function createPf1InfoContainer() {
    const { InfoContainer } = await import(
        '/modules/bg3-hud-core/scripts/components/containers/InfoContainer.js'
        );

    return class Pf1InfoContainer extends InfoContainer {
        /**
         * 面板内容
         * @returns {Promise<HTMLElement>}
         */
        async renderContent() {
            const actor = this.actor;
            const root = this.createElement('div', ['pf1-info-content']);
            if (!actor) return root;

            const hp = getHealth(actor);
            const ac = getAC(actor);
            const basics = getCombatBasics(actor);
            const level = getLevel(actor);

            /* ── 概要条 ─────────────────────────────── */
            const head = this.createElement('div', ['pf1-info-head']);
            // 瘀伤（非致命伤害）够多的时候 PF1 会把角色打晕，这里直接标出来
            const nonlethalNote =
                hp.nonlethal > 0
                    ? `<span class="pf1-info-pill pf1-info-nonlethal" title="瘀伤（非致命伤害）${
                          hp.nonlethal >= hp.value ? '：已达到当前生命值，角色处于晕眩/昏迷' : ''
                      }">瘀伤 ${hp.nonlethal}</span>`
                    : '';
            head.innerHTML = `
                <span class="pf1-info-name">${actor.name}</span>
                <span class="pf1-info-pill" title="生命值"><i class="fas fa-heart"></i> ${hp.value}/${hp.max}</span>
                ${hp.temp > 0 ? `<span class="pf1-info-pill" title="临时生命值">+${hp.temp}</span>` : ''}
                ${nonlethalNote}
                <span class="pf1-info-pill" title="等级">Lv ${level}</span>
                <span class="pf1-info-pill" title="护甲等级"><i class="fas fa-shield-alt"></i> ${ac.normal}</span>
                <span class="pf1-info-pill" title="接触 / 措手不及">${ac.touch} / ${ac.flatFooted}</span>
                <span class="pf1-info-pill" title="先攻"><i class="fas fa-bolt"></i> ${basics.init >= 0 ? '+' : ''}${basics.init}</span>
                <span class="pf1-info-pill" title="BAB / CMB / CMD">BAB ${basics.bab} · CMB ${basics.cmb} · CMD ${basics.cmd}</span>
            `;
            root.appendChild(head);

            /* ── 属性 ───────────────────────────────── */
            const mods = getAbilityMods(actor);
            const abilitiesRow = this.createElement('div', ['pf1-info-row', 'abilities']);
            for (const id of ABILITIES) {
                const cell = this.createElement('button', ['pf1-info-cell']);
                cell.innerHTML = `
                    <span class="label">${loc([`PF1.AbilityShort${cap(id)}`], id.toUpperCase())}</span>
                    <span class="value">${mods[id] >= 0 ? '+' : ''}${mods[id]}</span>`;
                cell.setAttribute('data-tooltip', `点击投 ${id.toUpperCase()} 属性检定`);
                this.addEventListener(cell, 'click', async (event) => {
                    event.preventDefault();
                    await rollAbility(actor, id, event);
                });
                abilitiesRow.appendChild(cell);
            }
            root.appendChild(abilitiesRow);

            /* ── 豁免 ───────────────────────────────── */
            const saves = getSaves(actor);
            const savesRow = this.createElement('div', ['pf1-info-row', 'saves']);
            for (const id of SAVES) {
                const cell = this.createElement('button', ['pf1-info-cell']);
                cell.innerHTML = `
                    <span class="label">${loc([`PF1.SavingThrow${cap(id)}`], id)}</span>
                    <span class="value">${saves[id] >= 0 ? '+' : ''}${saves[id]}</span>`;
                cell.setAttribute('data-tooltip', '点击投豁免');
                this.addEventListener(cell, 'click', async (event) => {
                    event.preventDefault();
                    await rollSave(actor, id, event);
                });
                savesRow.appendChild(cell);
            }
            root.appendChild(savesRow);

            /* ── 技能 ───────────────────────────────── */
            const skillsRow = this.createElement('div', ['pf1-info-row', 'skills']);
            for (const id of SHOWCASE_SKILLS) {
                const mod = getSkillMod(actor, id);
                const cell = this.createElement('button', ['pf1-info-cell']);
                cell.innerHTML = `
                    <span class="label">${loc([`PF1.Skill${cap(id)}`, `PF1.Skill${cap(id).toUpperCase()}`], id)}</span>
                    <span class="value">${mod >= 0 ? '+' : ''}${mod}</span>`;
                cell.setAttribute('data-tooltip', '点击投技能');
                this.addEventListener(cell, 'click', async (event) => {
                    event.preventDefault();
                    await rollSkill(actor, id, event);
                });
                skillsRow.appendChild(cell);
            }
            root.appendChild(skillsRow);

            /* ── 法术位 ─────────────────────────────── */
            const books = getSpellbooks(actor);
            if (books.length) {
                const spells = this.createElement('div', ['pf1-info-spells']);
                for (const book of books) {
                    const rows = Object.entries(book.slots ?? {})
                        .map(([lvl, slot]) => {
                            const max = Number(slot?.max) || 0;
                            if (max <= 0) return '';
                            const value = Number(slot?.value) || 0;
                            return `<span class="pf1-slot ${value <= 0 ? 'empty' : ''}" title="${book.label} ${lvl === '0' ? '戏法' : `${lvl} 环`}">
                                        <b>${lvl === '0' ? '0' : lvl}</b> ${value}/${max}
                                    </span>`;
                        })
                        .filter(Boolean)
                        .join('');
                    if (!rows) continue;
                    spells.insertAdjacentHTML(
                        'beforeend',
                        `<div class="pf1-spellbook"><span class="book">${book.label}（CL ${book.cl}）</span>${rows}</div>`
                    );
                }
                if (spells.children.length) root.appendChild(spells);
            }

            return root;
        }

        /**
         * 右键 d20 按钮 = 投先攻
         * @param {MouseEvent} event
         */
        async onButtonRightClick(event) {
            await rollInitiative(this.actor, event, this.token);
        }
    };
}
