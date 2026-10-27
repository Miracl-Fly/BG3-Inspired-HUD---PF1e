# BG3 Inspired HUD — PF1e 适配器（本地移植版）

给 **Pathfinder 1e**（pf1 v11.x）+ **Foundry VTT v13** 用的 [BG3 Inspired HUD](https://github.com/BragginRites/bg3-hud-core) 适配模块。

> **署名与授权说明（NOTICE）**
>
> - 本模块是**第三方、非官方**的 Pathfinder 1e 适配器，与 [BG3 Inspired HUD - Core](https://github.com/BragginRites/bg3-hud-core) 的作者 **BragginRites** 无从属关系，未经其官方认证。
> - 它**不包含、不打包、不修改** `bg3-hud-core` 的任何代码、样式或模板。运行时通过 `Hooks.on('bg3HudReady')` 使用 core 的公开适配器 API，并在 `module.json` 中以 `relationships.requires` 声明依赖。从 core 继承的两个基类（`AutoPopulateFramework` / `AutoSortFramework`）走的是动态 `import` + 失败降级，不会因为 core 内部改路径而拖垮整个模块。
> - core 本身**没有 LICENSE 文件**（仓库根目录与安装包内均无，`module.json` 也没有 `license` 字段），因此本模块只对自己的代码授权：**MIT**（见 `module.json` 的 `license`）。core 的版权仍归 BragginRites 所有。
> - BG3 视觉风格来自 Larian Studios 的 *Baldur's Gate 3*。本模块同样是同人创作，**不隶属于、未获背书于、也未与 Larian Studios、Wizards of the Coast 或 Baldur's Gate 3 相关联**。
> - 若原作者对命名或分发有异议，联系我，我会立刻改名或下架。

## 它是什么

`bg3-hud-core` 本身只是一个 UI 框架，不含任何规则逻辑——它把「格子、拖拽、持久化、提示框」写好，
然后等一个**系统适配器**告诉它：这个系统的血在哪、法术位怎么算、点一下物品该干什么。

官方的适配器只有 dnd5e / pf2e / dc20rpg / crucible，**没有 PF1**。这个模块就是补上这块：
按 core 0.8.0 的适配器契约，把 PF1 的数据接进那套 HUD。

## 已实现（v0.2）

| 部件 | 状态 | 说明 |
|---|---|---|
| 肖像血条 | ✅ | `system.attributes.hp`，含临时 HP、血量分档变色（低血闪烁） |
| 血量调整 | ✅ | 点血条/血量数字，输入正负值加减 HP |
| 肖像数据徽章 | ✅ | 默认 AC / 移动速度 / BAB（可在 HUD 里改成任意数据路径，支持 `{{system.x}}/{{system.y}}` 模板） |
| 信息面板 | ✅ | d20 按钮：等级、属性、豁免、常用技能、每个法术书的环位剩余；点哪个投哪个 |
| 投先攻 | ✅ | 右键 d20 按钮，或肖像右键菜单 |
| 热键栏自动填充 | ✅ | 新建 token 时按物品类型填进 0/1/2 号格（武器+战斗 / 法术 / 专长+职业特性+增益+消耗品）。**数量为 0 的物品（用完的卷轴、打光的箭矢）会被排除**，新建物品时也不自动占格 |
| 按环位选法术 | ✅ | 法术可以只勾某个环位（`spell:0` … `spell:9`），也可以勾「全部环位」 |
| 角色特性填充 | ✅ | 职业特性 / 种族特性 / 背景特性 / 其他能力 / 模板 —— PF1 把它们的 `type` 都写成 `feat`，靠 `system.subType` 区分（`classFeat` / `racial` / `trait` / `misc` / `template`）。**裸 `feat` 只匹配普通专长**，不会再顺带把职业特性一起塞进来 |
| 填充配置菜单 | ✅ | 设置 →「配置自动填充」，GM 可以改哪个格放哪些类型（走 core 自带的勾选框对话框） |
| 过滤器 | ✅ | 按物品类型、按法术环位（只列角色实际拥有的环位）、按特性子类型（职业/种族/背景，子类型按钮同样只在该角色有这类特性时出现） |
| 被动条 | ✅ | 常驻增益（buff）+ 无动作专长；有时限的 buff 不进被动条。**两个设置**（见下）可整条关掉或只留带「使用」次数的 |
| 武器组 | ✅ | 3 组 × 2 格，切组时改 `system.equipped` 真换手 |
| 自动排序 | ✅ | 点排序按钮按「类型 → 法术环位 → 名字」重排，和自动填充用同一套顺序 |
| 变更刷新 | ✅ | `resolveNotice` 把 updateActor 的 changes 映射到要刷新的部件（HP→生命条、法术位→全部格子等） |
| 富文本提示框 | ✅ | 悬停显示武器攻击/伤害/暴击/特性，法术环位/学派/施法时间/豁免，以及使用次数 |
| 点击使用 | ✅ | 走 `item.use()`，所以 PF1 自己的对话框、消耗、聊天卡全部照旧 |
| 右键菜单 | ✅ | 格子上右键：武器→投攻击 / 投伤害 / 装备切换；法术→施放 / 准备法术；消耗品与特性→使用。肖像右键：角色卡 / 投先攻 / 调血。控制按钮右键：core 的布局项 + 自动填充配置 + 诊断（走 core 的 `registerMenuBuilder` 契约） |
| 容器弹窗 | ✅ | 点容器格子会列出里面的东西（按子物品的 `flags.pf1.containerItem` 反查），弹窗内可再拖动 |
| 使用次数 | ✅ | 右上角充能 = `system.uses`（药水/魔杖/每日能力）或 `system.charges`。**卷轴/药水这类 `uses.per === "single"` 的物品显示 1/1**（一次用掉一张），左上角数量另算（9 张 = 数量 9）。以前这里会显示 0，因为 `Number(null) === 0`，现在显式按单次使用处理；数量为 0 时充能显示 0 并置灰 |
| 物品施法者等级（CL） | ✅ | **悬停**物品时在提示框**标题行最右侧**显示 `CL 3`（就是红框那片空白），读 `system.cl`。**不限消耗品**：卷轴/药水/魔杖/武器/护甲，凡是有 CL 的都显示；`cl` 为 0 或没填则不显示。**设置里默认关闭**（设置 → 在物品提示框显示施法者等级（CL））。字号 12px —— 格子上那种 9px 小字连同整套格子角标代码已在 0.8.13 删除，物品名不会再被挡 |
| 消耗品环数与豁免 DC | ✅ | **悬停**卷轴 / 药水 / 魔杖时，紧挨着 CL 显示 `2 环` 和 `DC 13`。PF1 11 没有 `spellLevel` 字段，这两个数是从 action 的 `save.dc` 公式里读的（`10 + 2[法术等级] + 1[施法属性]` → 环 2 / DC 13，中英文标签都认）。公式里混进 `@cl`、`undefined`、`NaN` 这类读不出来的东西就不显示，不瞎算；知道环数但没有豁免的，按 PF1 规则补 `10 + 环数 + floor(环数/2)`。法杖**不显示**（一个格子装好几个法术，取第一条会骗人）。**默认开启**，设置里可关 |
| 法术每日次数 | ✅ | 右上角 = **剩余**（0 时置灰），左上角 = **准备了几份**（仅准备施法）。有 PF1 文档时直接调 `item.getSpellUses(max)`，准备/自发/法术点三种情况都由系统自己算：**准备施法**读 `preparation`（油腻术 2 份 → 左上 2、右上 2，放一次右上变 1，没准备的 `max` 为 0 → 像充能 0 一样置灰）；**自发施法**读 `spellbook.spells["spellN"]` 的每日次数（不是 `slots`，也不是 PF1 给自发法术写的 `preparation 1/1` 占位值），同环共享、不显示左上角。随意使用（`atWill`）、戏法、法术点制不给数字 |
| 血条文字 | ✅ | 血条下面一行：**剩余/最大（红）· 瘀伤（紫）· 虚假生命（白）**，没有的部分不占位 |
| 瘀伤（非致命伤害） | ✅ | 血条右侧叠紫色斜纹表示 `system.attributes.hp.nonlethal`，信息面板概要行也有紫色「瘀伤 N」；调血对话框能加减瘀伤。瘀伤 ≥ 当前生命值时（PF1 的晕眩/昏迷线）token 会变紫 |
| 肖像受伤蒙层 | ✅ | 受伤越多，红色从肖像**底部往上**浮得越高（32/59 → 46% 高），按伤势深浅分四档浓度，濒死时会缓慢脉动；满血不显示。可在设置里单独关掉 |
| 地图 token 按血量染色 | ⬜（默认关） | 可选：75% 以下发黄、50% 以下橙红、25% 以下深红、倒地变灰、被瘀伤打晕变紫。写 `texture.tint`，原色记在 flag 里，回血时还原。**默认关闭**——这不是肖像效果；关掉后会把旧版本留下的颜色自动还原 |
| 休整 | ✅ | 依次尝试：已开着的休整窗口提最前 → `new ActorRestDialog({ document: actor })`（类可达时）→ 借角色卡的 `_onRest()`（PF1 自己的入口，尊重系统"跳过确认"设置）→ `actor.performRest({ verbose: true })`。**v11 的 `ActorRestDialog` 没有挂在 `pf1.applications` 上**（那里只有 ActionSelector/AttackDialog 等），所以只写 `new pf1.applications.ActorRestDialog()` 会静默失败——之前就是退回了角色卡 |
| 拖拽 | ✅ | 角色卡往 HUD 上拖物品，由 core 处理，本模块只负责转成格子数据 |

### 被动条的两个设置

肖像上方那排小格子（职业特性 / 专长 / 背景 / 常驻增益）现在受两个**客户端**设置控制，
在「配置设置 → 模块设置 → BG3 HUD PF1」里改：

| 设置 | 默认 | 作用 |
|---|---|---|
| 显示被动特性条 | 开 | 关掉 → 整条隐藏（连同齿轮热区一起 `display:none`，不会再挡点击） |
| 被动特性条显示范围 | 全部特性 | `全部特性` = 常驻特性都显示；`只显示带「使用」次数的` = 只留物品卡上有 Uses 池的（每日职业能力、药水、杖…），纯被动专长和常驻增益不显示 |

改完**重新选中 token**（或刷新页面）生效——这是纯显示偏好，不会动角色数据。
右键/点齿轮会弹出当前状态提示，不会像以前那样报「未实现」。

## 适配器契约覆盖

`registerAdapter()` 收到的适配器对象一共 **26 个成员**：21 个公开方法 + 3 个属性（`MODULE_ID` / `systemId` / `name`）+ 2 个框架实例（`autoPopulate` / `autoSort`）。

core 0.8.0 会去调用的成员，全部实现（逐个在 `bg3-hud-core/scripts` 里 grep 过调用点）：

| 成员 | core 里的调用点 |
|---|---|
| `isCompatible` / `isPlayerCharacter` | registry、TokenHUD 开关判定 |
| `getDisplaySettings` | `BG3Hotbar.js`、`registry.js` |
| `getPortraitDataDefaults` | `PortraitContainer.js:292` |
| `transformItemToCellData` | `PersistenceManager`、`UpdateCoordinator`、拖拽 |
| `transformActivityToCellData` / `transformActionToCellData` | 同上（PF1 无对应概念，返回 `null`） |
| `decorateCellElement` | `GridCell.js`、各容器（写 `dataset.itemType/level/subType`） |
| `onCellClick` | `BG3Hotbar.js`、`InteractionCoordinator.js` |
| `getCellMenuItems` | `SlotContextMenu.js:66` |
| `getContainerContents` | `ContainerPopover.js:53` |
| `isContainer` | `InteractionCoordinator.js:135` |
| `shouldAutoAddItem` | `ItemUpdateManager.js:364` |
| `shouldBlockFromHotbar` | `InteractionCoordinator.js:498` |
| `resolveHotbarMembershipOnItemUpdate` | `ItemUpdateManager.js:244` |
| `isHeldItem` / `isTwoHanded` | `InteractionCoordinator.js:52`、`occupancy.js` |
| `resolveExternalDragData` | `InteractionCoordinator.js:628` |
| `resolveNotice` | `UpdateCoordinator.js:222`、`resolveNotice.js` |
| `autoPopulatePassives` | `core/module.js:145` |
| `onTokenCreationComplete` | `core/module.js:175` |
| `autoPopulate` / `autoSort` | 框架实例，`ItemUpdateManager` 与 `AutoPopulateFramework` 直接用 |

另外还有两个**不在适配器对象上、但属于同一套契约**的注册接口，也都接了：

| 注册接口 | core 里的消费点 |
|---|---|
| `registerMenuBuilder(systemId, Builder, {adapter})` | `PortraitContainer.js:397`、`ControlContainer.js:259/365` 的 `getMenuBuilder()` |
| `registerTooltipRenderer(systemId, fn)` | `TooltipFactory`，格子悬停时调用 |

dnd5e 里还有 `attachFilterFields` / `decorateElementFromCellData` / `registerAdvantageHooks` / `saveContainerContents`，
这些**core 完全不引用**（是那个适配器内部的辅助方法或它自己扩展的钩子），所以没实现。

## 还没做

- **目标选择器**（`targetingRules`）：PF1 没有 5e 的 activity/目标结构，需要单独设计
- **`resolveNotice`**：目前用 core 的系统无关默认值（更新时闪一下相关格子），够用
- **自定义 activeEffects 容器**：现在直接用 core 的，PF1 的 buff 图标能显示，但没有按 PF1 规则分组
- **多法术书切换**：信息面板把所有法术书都列出来，但热键栏不会按书分组

## 安装

把本目录整个放进 `.../Data/modules/bg3-hud-pf1/`（本机已就位），然后：

1. Foundry 的「附加模块」里启用 **BG3 Inspired HUD - Core** 和 **BG3 Inspired HUD - PF1e**
2. 重载世界
3. 选一个 PF1 角色 token → 左下角出现 HUD；不出现的话按 `T` 或 token 工具栏里的手柄图标切换

## 依赖与兼容

- Foundry VTT **13**（core 0.8.0 要求 ≥13）
- `bg3-hud-core` **≥ 0.8.0**
- PF1 **≥ 10**（在 11.11 + V13 上开发）

## 自检

仓库里带了两套离线自检（不需要启动 Foundry）：

```bash
node pf1-smoke.mjs            # 数据层：HP/AC/豁免/法术位/次数/提示框（26 项）
node pf1-integration-test.mjs # 注册流程：真的加载 core，断言部件/契约/过滤/排序/通知/设置菜单/提示框 CL 与环数-DC、被动条两个设置（102 项）
```

集成测试需要 `C:\modules\bg3-hud-core` 指向 core 的 ESM 镜像（`core-esm/`，就是把安装好的
core 复制一份并加 `{"type":"module"}` 的 package.json），因为模块里用的 `/modules/...` 是
浏览器绝对路径，Node 需要这个映射才能解析。

## 排错

打开浏览器控制台，过滤 `bg3-hud-pf1`：注册流程每一步都有日志。

**最快的一步：** 控制台输入

```js
await game.bg3HudPf1.diagnose()
```

它会打印一份快照：适配器/6 个部件是否注册、当前 token 的 HP/AC/等级、DOM 里血条/格子/过滤按钮/武器组各命中多少个、
以及**最近捕获的与 bg3-hud 有关的报错**（模块自己挂了个环形缓冲，最多 25 条，只收相关的）。
把这段输出贴出来，比"看着不对"有用得多。

常见情况：

- **HUD 不出现** → 先看是否只有 core、没有适配器；core 检测不到适配器时会跳过整个 HUD
- **血条不动** → 确认装的模块没改写 `system.attributes.hp.value`（如 health-monitor）
- **格子点了没反应** → 检查物品是否有 `system.actions`；PF1 的部分纯描述物品本来就不带动作
- **过滤器点了没反应** → 说明格子的 `dataset.itemType` 没写上，通常是格子数据里缺 `itemType` 且 uuid 解析失败
- **同一格堆了太多东西** → 自动填充是"往空格里塞"，在同一个格子上多点几次会叠加；用右键单个格子重填或手动拖开

## 许可

本模块只是适配层，不含 core 的任何代码；core 的许可见其仓库。PF1 系统的数据与规则归 Paizo / PF1 开发组。
