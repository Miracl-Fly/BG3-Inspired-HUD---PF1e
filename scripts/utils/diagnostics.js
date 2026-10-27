/**
 * 自诊断
 *
 * 目标：把"看起来不对"变成可复制的一段文字。
 * 用户在控制台敲 `game.bg3HudPf1.diagnose()`，就能得到：
 *   - 注册状态（适配器、6 个部件、提示框渲染器）
 *   - 当前选中 token 的 PF1 数据（HP/AC/等级）
 *   - 真实 DOM 里到底有没有血条 / 格子 / 过滤按钮 / 武器组
 *   - 最近捕获到的、与 bg3-hud 有关的报错
 *
 * 之所以要抓报错：HUD 的渲染发生在一堆 async 回调里，报错经常只是 console.error，
 * 用户很难复述；这里挂个环形缓冲，让 diagnose() 一并吐出来。
 */

const MAX_ERRORS = 25;

/** @type {Array<{kind:string, detail:string, at:string}>} */
const captured = [];

let installed = false;
/** core 的 API（模块注册时注入） */
let api = null;

/** 只关心自己这条链路的报错，避免把整个世界无关的噪音也记下来 */
const RELEVANT = /bg3-hud|Bg3Hud|BG3HUD|Pf1(Adapter|Portrait|Info|Filter|Passives|WeaponSet)/;

/**
 * 开始捕获全局报错
 */
export function installErrorCapture() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    const record = (kind, detail) => {
        captured.push({ kind, detail: String(detail).slice(0, 1000), at: new Date().toISOString() });
        if (captured.length > MAX_ERRORS) captured.shift();
    };

    window.addEventListener('error', (event) => {
        const text = `${event?.message ?? ''} ${event?.filename ?? ''} ${event?.error?.stack ?? ''}`;
        if (!RELEVANT.test(text)) return;
        record('error', text);
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        const text = reason?.stack ?? reason?.message ?? String(reason ?? '');
        if (!RELEVANT.test(text)) return;
        record('rejection', text);
    });
}

/**
 * 注入 core API（bg3HudReady 里调用）
 * @param {Object} BG3HUD_API
 */
export function setApi(BG3HUD_API) {
    api = BG3HUD_API ?? null;
}

/**
 * 取出捕获到的报错（返回副本，避免外部改到内部数组）
 * @returns {Array<{kind:string, detail:string, at:string}>}
 */
export function getCapturedErrors() {
    return captured.map((e) => ({ ...e }));
}

/** 清空缓冲区 */
export function clearCapturedErrors() {
    captured.length = 0;
}

/**
 * 统计 DOM 里某个选择器命中多少（没有 document 时返回 -1，便于区分"环境没有"和"渲染了 0 个"）
 * @param {string} selector
 * @returns {number}
 */
function count(selector) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return -1;
    try {
        return document.querySelectorAll(selector).length;
    } catch {
        return -1;
    }
}

/**
 * 当前被 HUD 绑定的 actor（优先 canvas 里选中的 token）
 * @returns {Actor|null}
 */
function currentActor() {
    try {
        const controlled = globalThis.canvas?.tokens?.controlled ?? [];
        if (controlled.length === 1) return controlled[0].actor ?? null;
        if (controlled.length > 1) return controlled[0].actor ?? null;
    } catch {
        /* ignore */
    }
    try {
        // 回退：HUD 可能正显示某个 actor
        return ui?.BG3HOTBAR?.actor ?? ui?.BG3HUD_APP?.actor ?? null;
    } catch {
        return null;
    }
}

/**
 * 收集一份诊断快照
 * @returns {Promise<Object>}
 */
export async function collectDiagnostics() {
    const actor = currentActor();
    const hp = actor?.system?.attributes?.hp;
    const ac = actor?.system?.attributes?.ac;

    const parts = {};
    for (const key of ['portrait', 'characterInfo', 'filter', 'passives', 'weaponSet']) {
        const part = api?.getNamedHudPart?.(key);
        parts[key] = typeof part === 'function' ? (part.name || 'class') : 'MISSING';
    }
    parts.rest = typeof api?.getNamedHudPart?.('rest') === 'function' ? 'fill' : 'MISSING';

    const adapter = api?.getActiveAdapter?.();

    return {
        module: {
            id: 'bg3-hud-pf1',
            version: game?.modules?.get?.('bg3-hud-pf1')?.version ?? '0.5.2',
            coreApi: Boolean(api),
            tooltipManager: Boolean(api?.getTooltipManager?.())
        },
        foundry: {
            version: game?.version,
            system: game?.system?.id,
            systemVersion: game?.system?.version,
            language: game?.i18n?.lang
        },
        adapter: {
            name: adapter?.constructor?.name ?? 'MISSING',
            systemId: adapter?.systemId ?? null,
            autoPopulate: Boolean(adapter?.autoPopulate),
            autoSort: Boolean(adapter?.autoSort)
        },
        parts,
        token: actor
            ? {
                  name: actor.name,
                  type: actor.type,
                  hp: hp ? `${hp.value}/${hp.max}${hp.temp ? ` (+${hp.temp})` : ''}` : 'n/a',
                  nonlethal: hp?.nonlethal ?? 0,
                  ac: ac?.normal?.total ?? 'n/a',
                  level: actor.system?.details?.level?.value ?? actor.system?.details?.cr?.total ?? 'n/a',
                  items: actor.items?.size ?? actor.items?.length ?? 0,
                  statuses: Array.isArray(actor.statuses) ? actor.statuses.length : (actor.statuses?.size ?? 0)
              }
            : null,
        dom: {
            portraitContainer: count('.bg3-portrait-container'),
            healthBar: count('.pf1-hp-wrap'),
            nonlethalStrip: count('.pf1-hp-nonlethal'),
            hotbarCells: count('.bg3-hotbar-container .grid-cell, .bg3-grid-cell'),
            filterButtons: count('.bg3-filter-container button, .filter-button'),
            weaponSets: count('.bg3-weapon-container'),
            infoPanel: count('.bg3-info-panel'),
            settingsMenuVisible: count('[data-setting-id="bg3-hud-pf1.autoPopulateEnabled"]')
        },
        // token 染色状态：tint 是 token 文档现在的颜色，expected 是按当前血量算出来的应为颜色
        tint: collectTintInfo(actor),
        errors: getCapturedErrors()
    };
}

/**
 * 读取 token 染色相关状态（方便确认"到底有没有染色"）
 * @param {Actor|null} actor
 * @returns {Object}
 */
function collectTintInfo(actor) {
    const info = { enabled: null, tint: null, expected: null, owner: null };
    try {
        info.enabled = game.settings.get('bg3-hud-pf1', 'tintTokenByHealth');
    } catch {
        info.enabled = 'unregistered';
    }
    try {
        const doc =
            canvas?.tokens?.controlled?.[0]?.document ??
            (actor
                ? canvas?.tokens?.placeables?.find((t) => t.actor?.id === actor.id)?.document
                : null);
        if (doc) {
            info.tint = doc.texture?.tint ?? '';
            info.owner = Boolean(game.user?.isGM || doc.isOwner);
            info.originalTint = doc.getFlag?.('bg3-hud-pf1', 'originalTint') ?? null;
        }
    } catch {
        /* ignore */
    }
    // 期望值：把 portrait 容器上的算法复刻一遍（只为了对账，避免诊断依赖 DOM）
    const hp = actor?.system?.attributes?.hp;
    if (hp) {
        const max = Math.max(Number(hp.max) || 1, 1);
        const value = Math.min(Number(hp.value) || 0, max);
        const ratio = value / max;
        const nonlethal = Math.max(Number(hp.nonlethal) || 0, 0);
        if (value <= 0) info.expected = '#6b6b6b';
        else if (nonlethal > 0 && nonlethal >= value) info.expected = '#7d3f98';
        else if (ratio > 0.75) info.expected = '';
        else if (ratio > 0.5) info.expected = '#e8d27a';
        else if (ratio > 0.25) info.expected = '#d97b3a';
        else info.expected = '#a32424';
    }
    return info;
}

/**
 * 打印诊断（用户复制这段输出给我就行）
 * @returns {Promise<Object>}
 */
export async function runDiagnostics() {
    const snapshot = await collectDiagnostics();
    /* eslint-disable no-console */
    console.group('%c bg3-hud-pf1 诊断 ', 'background:#2c3e50;color:#fff;padding:2px 4px;border-radius:3px');
    console.log('模块 / 环境:', snapshot.module, snapshot.foundry);
    console.log('适配器:', snapshot.adapter);
    console.log('部件注册:', snapshot.parts);
    console.log('当前 token:', snapshot.token);
    console.log('DOM 命中数（-1 = 没有 document）:', snapshot.dom);
    if (snapshot.errors.length) {
        console.warn(`捕获的报错（最近 ${snapshot.errors.length} 条）:`, snapshot.errors);
    } else {
        console.log('捕获的报错: 无');
    }
    console.log('完整快照（可 JSON.stringify 后贴给我）:', snapshot);
    // 最后再打一行紧凑 JSON，方便整行复制
    try {
        console.log('一行版（直接复制这行）:', JSON.stringify(snapshot));
    } catch {
        /* 循环引用时忽略 */
    }
    console.groupEnd();
    /* eslint-enable no-console */
    return snapshot;
}

/**
 * 把诊断复制到剪贴板（浏览器有 Clipboard API 时）
 * @returns {Promise<string>} 复制的内容
 */
export async function copyDiagnostics() {
    const snapshot = await collectDiagnostics();
    const text = JSON.stringify(snapshot, null, 2);
    try {
        await navigator.clipboard.writeText(text);
        console.log('%c bg3-hud-pf1 诊断已复制到剪贴板 ', 'background:#27ae60;color:#fff');
    } catch {
        console.log('%c 剪贴板不可用，请手动复制下面的内容 ', 'background:#c0392b;color:#fff');
        console.log(text);
    }
    return text;
}
