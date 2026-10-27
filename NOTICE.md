# NOTICE · 署名与授权说明

本文件说明 `bg3-hud-pf1`（BG3 Inspired HUD — PF1e 适配器）与原作、与第三方的关系。

## 本模块是什么

- 一个**第三方、非官方**的 Pathfinder 1e 适配模块，属于 [BG3 Inspired HUD](https://github.com/BragginRites/bg3-hud-core) 生态的插件。
- 作者与 **BragginRites**（BG3 Inspired HUD 的作者）无从属关系，未获其官方认证或背书。

## 与 bg3-hud-core 的关系

- 本模块**不包含、不打包、不修改** `bg3-hud-core` 的任何代码、样式或模板。
- 运行时通过公开接口对接：
  - `Hooks.on('bg3HudReady', api)` → `api.registerNamedHudParts()` / `api.registerAdapter()` / `api.registerTooltipRenderer()` / `api.registerMenuBuilder()`
  - `module.json` 里以 `relationships.requires` 声明对 `bg3-hud-core >= 0.8.0` 的依赖
- 有两个基类（`AutoPopulateFramework` / `AutoSortFramework`）来自 core 的内部文件路径，
  通过 `scripts/utils/coreBridge.js` 动态 `import` 并在失败时降级（只影响自动填充/排序，不影响其余组件）。

## 授权状况

| 对象 | 许可 | 说明 |
|---|---|---|
| `bg3-hud-core`（BragginRites） | **未声明许可** | 截至 2026-10-26：仓库根目录无 LICENSE 文件，GitHub API 返回 `"license": null`，`module.json` 无 `license` 字段，README 与 Foundry 页面均无授权条款。按默认规则**保留所有权利**。 |
| 本模块 `bg3-hud-pf1` | **MIT** | 见 `module.json` 的 `license` 字段。仅覆盖本仓库自己的代码，不覆盖 core。 |

因为没有获得 core 的再分发授权，**请勿**把 `bg3-hud-core` 打包进本模块的发行包；
用户应自行从 Foundry 或原作仓库安装 core。

## 商标与 IP

Baldur's Gate 3 及相关视觉风格属于 Larian Studios。本模块是**同人创作**，
不隶属于、未获背书于、也未与 Larian Studios、Wizards of the Coast 或 Baldur's Gate 3 相关联。

## 异议处理

若原作者对本模块的命名或分发方式有异议，请联系本模块作者，我们会立即改名或下架。
