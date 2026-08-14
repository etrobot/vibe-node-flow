# 呈现 Step 02 · Timeline JSON

<!-- CREATOR:SPEC:START -->

读取已确认脚本，只输出有效 timeline JSON，不要输出任何解释或 Markdown。（下面 ``` 代码块里以 `#` 开头的行是字段说明，只帮你理解，绝不能出现在你的 JSON 输出里。）

## 一、整体结构

- 输入是一份已确认脚本：`---` 前是信息规划表，`---` 后是旁白正文。只把旁白正文逐字作为 `speech` 来源；规划表只用于理解事实、对象和结构，不得进入口播。
- 顶层只有三个 key：
  ```
  { "title": "…", "global-components": [ … ], "clips": [ … ] }
  # title：视频标题
  # global-components：flow / loopflow / text-lines / structure / story 的结构定义，用唯一 key 复用，最多 12 个（详见第三节）
  # clips：按旁白顺序排列的分句
  ```
- 每个 clip 只有 `speech` 和 `shots`：
  ```
  { "speech": "旁白原文，含 **锚点**。", "shots": [ {…}, {…} ] }
  # speech：逐字来自旁白正文；只有 **…** 是本阶段新增的视觉锚点，与原文是否加粗无关
  # shots：该句对应画面，按旁白顺序排列，1–40 个
  ```
- 这是 16:9 视频的 AE / MG 画面规格，不是网页 UI、PPT 或信息面板。组件服务于时间轴、镜头、运动、构图和情绪，不要默认做卡片、胶囊、导航、标签栏、进度条、步骤条、仪表盘或网页式状态面板。
- 每个组件都要有明确的入场、停留、变化、退场节奏；同一 shot 长时间没有运动或信息变化视为失败。优先用尺度、位置、遮罩、景别、景深、动势线、粒子和动效文字表达，不要把静态内容堆成 UI。
- flow 每个节点、text-lines 每一行、structure 每张卡、story 每一帧都必须有唯一、精简、稳定的英文 `key`。

## 二、旁白锚点（`**加粗**` = 换镜点）

- `**短语**` 是 shot 切换的时间锚点。一个 clip 有 N 个 shots 时，`speech` 必须恰好有 N-1 个 `**…**`：第 1 个锚点启动 `shots[1]`，第 2 个启动 `shots[2]`，依此类推。必须先排好 shots，再按顺序逐个选锚点。
- shot 数量由真实语义节拍决定：出现新的信息点、动作、数字、对象、对比、转折或情绪变化时可增加 shot，但不要为凑固定数量重复画面。避免整段只有一个静止画面（这是质量建议，不能为此破坏旁白或组件结构）。
- 当锚点对应的 shot 带全局 `key`（尤其还带 `spot`）时，优先加粗与被引用节点匹配的文字：先按 `key` 找到 global component，再按 `spot` 找到 flow/loopflow 节点的 `label`、text-lines 的 `text`、structure 卡片的 `label`，或 story 对应对象/状态/popup；加粗旁白中与该节点显示名完全一致或语义最接近的最短完整短语。英文 key 本身不必出现在旁白里。
- 禁止跳过当前 key/spot 对应词、转而加粗同一句后面属于下一层说明的更具体文字。例：目标 shot 是 `{ "component":"flow", "key":"pricing-flow", "spot":"model" }`、`model` 节点 label 是“建立数据模型”，旁白“第一步，建立数据模型。客户表记录每个客户的历史订单”必须写成“第一步，**建立数据模型**。客户表记录每个客户的历史订单”，不能写成“第一步，建立数据模型。**客户表记录每个客**户的历史订单”。
- 不带 `key` 的 shot 才按组件语义选锚点：数字组件配对应数字，logo 配品牌名，meme 配情绪或反转短语，其他组件配其直接表达的关键词/结论/转折；没有完全一致的词时选语义最接近的短语，不要只为均匀分布标记无关文字。
- 加粗范围必须是适合作为换镜点的完整关键词、数字、结论或转折短语；禁止截断词语或句子成分（如 `**客户表记录每个客**户`）、只加粗标点/语气词、或加粗整段旁白。每次换镜都要对应明确语义，禁止用无语义重复画面虚增密度。

## 三、组件目录（11 种 `component`）

只能使用：`text-typing`、`rolling-number`、`flow`、`loopflow`、`text-lines`、`structure`、`story`、`clock`、`linechart`、`meme`、`logo`。

`flow`、`loopflow`、`text-lines`、`structure`、`story` 必须先在 `global-components` 里定义、再由 shot 用 `key`(+`spot`) 引用；其余组件直接写在 shot 里。

### text-typing —— 开场文字
```
{ "component": "text-typing", "text": "Observe. Act. Verify." }
# 只能作为每个 clip 的第一个开场 shot；shots[1] 及之后严禁使用
# text：随旁白逐字出现的短文本
```

### rolling-number —— 关键数字
```
{ "component": "rolling-number", "symbol": "$", "number": 3000, "label": "制作成本" }
# 旁白出现明确数字时用，快速滚动到 number
# symbol：可选前缀（$、% 等）   number：目标数值   label：数字含义
```

### flow —— 单向流程 / 步骤
```
# ── 在 global-components 里定义：flow 数组 2–6 个节点 ──
{ "key": "browser-agent-flow", "component": "flow", "flow": [
  { "key": "observe", "icon": "Search", "label": "Observe" },
  { "key": "act", "icon": "Bot", "sub-icon": "Wrench", "label": "Act" }
] }
# icon：Lucide 图标名   label：画面显示名
# sub-icon：可选，表示该节点额外连接的工具/数据库/外部系统——仅当旁白明确需要支线时才填，否则不填、禁止随机填充
# ── 在某个 clip 的 shots 里引用 ──
{ "component": "flow", "key": "browser-agent-flow", "spot": "act" }
# key：指向上面的全局定义   spot：必填，聚焦到某个节点 key；同一 flow 复用时按语义选对应节点
```

### loopflow —— 循环 / 反馈闭环
```
# ── 在 global-components 里定义：loopflow 数组 3–8 个节点 ──
{ "key": "growth-loop", "component": "loopflow", "loopflow": [
  { "key": "create", "icon": "Sparkles", "label": "创作", "detail": "生成下一版" },
  { "key": "optimize", "icon": "RotateCcw", "label": "优化", "detail": "反馈进入新循环" }
] }
# 用于会反复运行、持续优化、反馈回流的循环流程；普通单向步骤仍用 flow
# detail：可选，节点补充说明
# ── shots 引用 ──
{ "component": "loopflow", "key": "growth-loop", "spot": "optimize" }
# key + spot 必填，聚焦当前环节
```

### text-lines —— 清单 / 目标 / 逐条结论
```
# ── 在 global-components 里定义：lines 数组 1–12 行 ──
{ "key": "missions", "component": "text-lines", "lines": [
  { "key": "m1", "text": "✅ Mission 1" },
  { "key": "m2", "text": "✅ Mission 2" }
] }
# 用于任务清单、目标、使命、检查项、逐条结论
# ── shots 引用 ──
{ "component": "text-lines", "key": "missions", "spot": "m2" }
# key + spot 必填；画面累计显示到 spot 对应行，后续 clip 可继续 spot 到下一行
```

### structure —— 结构 / 分类 / 方案对比
```
# ── 在 global-components 里定义：cards 是二维数组，外层=行、内层=该行卡片 ──
{ "key": "deployment-plans", "component": "structure", "cards": [
  [ { "key": "cloud", "icon": "Globe2", "label": "Cloud API", "span": 3 } ],
  [ { "key": "local", "icon": "Database", "label": "Local model", "span": 2 },
    { "key": "hybrid", "logo": "openai", "label": "Hybrid", "span": 1 } ]
] }
# 通用结构化组件：层级、分类、属性、模块、步骤组、方案、对比，不限于价格
# 每行卡片数可不同；不要输出 columns 或其他布局参数
# 卡片视觉二选一：icon（Lucide 名）或 logo（品牌 key），禁止同时填，也可纯文字；卡片禁止用 meme
# span：可选正数（≤24），控制同一行内宽度比例；只有填了 span 的卡才参与比例伸缩，未填的按 label 宽度在行内均匀分布
# 所有行等宽、首尾卡片左右对齐；超过两行显示“左视觉+右 label”，超过五列只显示视觉，所以每张卡都要给有语义的 icon 或 logo
# ── shots 引用 ──
{ "component": "structure", "key": "deployment-plans", "spot": "hybrid" }
# key 必填；spot 可选，只在需要突出某一分类/层级节点时填
```

### story —— 三列人物故事图
```
# 左=角色A、中=物件、右=角色B，演绎“某类人遇到什么痛点→如何反应→如何找到出路→最终什么状态”。不要显示帧编号、时间线、进度条、步骤条或网页卡片。
# ── 在 global-components 里定义 ──
{ "key": "buyer-pain-story", "component": "story",
  "cast": [
    { "key": "buyer", "role": "character", "preset": "consultant", "label": "企业咨询顾问" },
    { "key": "delivery", "role": "object", "icons": ["bot", "file-text", "triangle-alert"], "label": "AI 交付" }
  ],
  "list": [
    { "object": "buyer", "state": "neutral", "popup": "会议开了三轮，问题还在。" },
    { "object": "delivery", "state": "broken", "popup": "关键结论仍然缺失。" },
    { "object": "buyer", "state": "confident", "popup": "可靠结果值得付费。" }
  ]
}
# cast：1–3 个对象；role:"character" 最多 2 个（左右两列），role:"object" 是中列抽象概念
#   character：preset 必须是预置角色 key（见下），label 是画面显示名，可选 "ethnicity"：east-asian / black / white
#   object：icons 用 2–4 个 Lucide 名共同表达一个概念；不传 preset/颜色/形状，自动分配马卡龙色与白色毛玻璃底座
# list：扁平帧序列 3–12 帧，每帧只把某一个对象切到某个状态，随旁白轮流演绎
#   object：必须是 cast 里的 key    popup：可选短气泡
#   state：character 用 neutral / worried / overwhelmed / frustrated / determined / confident；object 用 idle / active / strained / broken / gone
#   同一“对象-状态”只能出现一次；角色只能用 character 状态，物件只能用 object 状态
# preset 预置角色 key：protagonist、interior-designer、consultant、doctor、lawyer、accountant、financial-advisor、executive、fitness-woman、office-worker-woman、silver-haired-expert、homemaker、small-business-owner、athletic-man（小店老板/个体户/小微企业主优先 small-business-owner）
# ── shots 引用：spot = “对象-状态” ──
{ "component": "story", "key": "buyer-pain-story", "spot": "delivery-broken", "bubble": "这份 AI 交付谁能直接用？" }
# spot 就是某帧的 "object-state"（如 buyer-neutral、delivery-broken）   bubble：可选，临时覆盖该帧 popup
# 同一 story 可在多个 shots/clips 用不同 spot 连续演完痛点到理想；不同故事用不同全局 key
```

### clock —— 时间压力
```
{ "component": "clock", "direction": "forward" }
# 只能用于旁白明确描述时间：等待、加载、耗时、延迟、超时、倒计时，或出现秒/分钟/小时；其他语义严禁使用
# direction："forward"=经过时间/持续等待，"reverse"=倒计时
```

### linechart —— 趋势 / 突破
```
{ "component": "linechart", "linechart": ["1k", "2k", "3k", "5k"] }
# 趋势变化时用；2–8 个点，元素是数字或 "1k"/"5k" 这类字符串
```

### meme —— 情绪 / 反转
```
{ "component": "meme", "keytext": "building-collapse" }
# 只用于旁白真实存在的吐槽、反转、尴尬、震惊、崩溃、得意等情绪节拍；不要当技术说明的默认画面，也不要连续堆叠语义重复的 meme
# keytext 按情绪选：building-collapse=系统/架构/业务崩塌，rocket-launch=发布/起飞/高速增长，rage=暴走/慌乱，wojak-npc=困惑/机械/茫然，smug=得意/早已看穿，love-it=非常喜欢，success-kid=成功，facepalm=无语，stonks=荒诞增长，always-has-been=反转揭晓（旧 meme 仍可用，但别反复用 wojak-crying）
```

### logo —— AI 品牌
```
{ "component": "logo", "keytext": "openai", "label": "OpenAI" }
# 只在旁白明确提到某个 AI 模型/厂商/产品时用；不要用 logo 表达抽象的“AI”
# keytext 品牌 key：openai、claude、deepseek、cursor、gemini、grok、glm    label：可选品牌名
```

## 四、组件选择原则

- 失败/风险/崩溃/情绪 → 语义匹配的 `meme`；流程步骤 → `flow`；反复迭代闭环 → `loopflow`；明确数字 → `rolling-number`；趋势变化 → `linechart`；结构/分类/方案对比 → `structure`；具体人物痛点叙事 → `story`。
- 旁白出现具体人物/职业，以及花钱耗时未解决、AI 交付混乱、寻找替代品、明确付费意愿、选择混乱、理想状态等需求叙事时，优先用 `story` 演绎角色与物件的状态变化，不要用 meme 代替真实人物痛点，也不要硬塞成普通 flow。

<!-- CREATOR:SPEC:END -->

<!-- CREATOR:COMPONENTS:START -->

```json
{
  "global-components": [
    {
      "key": "main-flow",
      "component": "flow",
      "flow": [
        { "key": "observe", "icon": "Search", "label": "观察" },
        { "key": "act", "icon": "Bot", "sub-icon": "Wrench", "label": "执行" }
      ]
    },
    {
      "key": "missions",
      "component": "text-lines",
      "lines": [
        { "key": "m1", "text": "✅ Mission 1" },
        { "key": "m2", "text": "✅ Mission 2" },
        { "key": "m3", "text": "✅ Mission 3" }
      ]
    },
    {
      "key": "growth-loop",
      "component": "loopflow",
      "loopflow": [
        { "key": "create", "icon": "Sparkles", "label": "创作", "detail": "生成内容" },
        { "key": "publish", "icon": "Globe2", "label": "发布", "detail": "触达用户" },
        { "key": "measure", "icon": "BarChart3", "label": "衡量", "detail": "收集反馈" },
        { "key": "optimize", "icon": "RotateCcw", "label": "优化", "detail": "进入下一轮" }
      ]
    },
    {
      "key": "main-taxonomy",
      "component": "structure",
      "cards": [
        [{ "key": "vision", "icon": "Search", "label": "交互层", "span": 3 }],
        [
          { "key": "dom", "icon": "FileText", "label": "数据库", "span": 2 },
          { "key": "loop", "icon": "RotateCcw", "label": "微服务", "span": 1 }
        ]
      ]
    },
    {
      "key": "designer-pain-story",
      "component": "story",
      "cast": [
        {
          "key": "designer",
          "role": "character",
          "preset": "interior-designer",
          "label": "室内设计师"
        },
        {
          "key": "delivery",
          "role": "object",
          "icons": ["bot", "file-text", "triangle-alert"],
          "label": "AI 交付"
        }
      ],
      "list": [
        { "object": "designer", "state": "neutral", "popup": "原本以为 AI 可以直接交付。" },
        { "object": "delivery", "state": "strained", "popup": "每次生成都像不同项目。" },
        { "object": "designer", "state": "frustrated", "popup": "时间和预算都在消耗。" },
        { "object": "delivery", "state": "broken", "popup": "这份交付没法直接用。" },
        { "object": "designer", "state": "confident", "popup": "现在可以稳定交付了。" }
      ]
    }
  ],
  "shots": [
    { "component": "text-typing", "text": "短文本" },
    { "component": "rolling-number", "symbol": "$", "number": 3000, "label": "制作成本" },
    { "component": "flow", "key": "main-flow", "spot": "act" },
    { "component": "loopflow", "key": "growth-loop", "spot": "optimize" },
    { "component": "text-lines", "key": "missions", "spot": "m2" },
    { "component": "structure", "key": "main-taxonomy", "spot": "dom" },
    {
      "component": "story",
      "key": "designer-pain-story",
      "spot": "delivery-broken",
      "bubble": "这份 AI 交付谁能直接用？"
    },
    { "component": "clock", "direction": "forward" },
    { "component": "linechart", "linechart": ["1k", "2k", "3k", "5k"] },
    { "component": "meme", "keytext": "expensive-shock" },
    { "component": "meme", "keytext": "wojak-crying" },
    { "component": "meme", "keytext": "wojak-npc" },
    { "component": "meme", "keytext": "wojak-soyjak" },
    { "component": "meme", "keytext": "pepe" },
    { "component": "meme", "keytext": "jim-carrey-typing" },
    { "component": "meme", "keytext": "distracted-boyfriend" },
    { "component": "meme", "keytext": "expanding-brain" },
    { "component": "logo", "keytext": "openai", "label": "OpenAI" }
  ]
}
```

<!-- CREATOR:COMPONENTS:END -->

<!-- CREATOR:FULL_VIDEO:START -->

```json
{
  "title": "AI browser automation",
  "global-components": [
    {
      "key": "buyer-pain-story",
      "component": "story",
      "cast": [
        { "key": "buyer", "role": "character", "preset": "consultant", "label": "企业咨询顾问" },
        {
          "key": "delivery",
          "role": "object",
          "icons": ["bot", "file-text", "triangle-alert"],
          "label": "AI 交付"
        }
      ],
      "list": [
        { "object": "buyer", "state": "neutral", "popup": "会议开了三轮，问题还在。" },
        { "object": "delivery", "state": "strained", "popup": "AI 交付没有统一结构。" },
        { "object": "buyer", "state": "frustrated", "popup": "需要的不是更多草稿。" },
        { "object": "delivery", "state": "broken", "popup": "关键结论仍然缺失。" },
        { "object": "buyer", "state": "confident", "popup": "可靠结果值得付费。" }
      ]
    },
    {
      "key": "browser-agent-flow",
      "component": "flow",
      "flow": [
        { "key": "observe", "icon": "Search", "label": "Observe" },
        { "key": "plan", "icon": "BrainCircuit", "label": "Plan" },
        { "key": "act", "icon": "Bot", "label": "Act" },
        { "key": "verify", "icon": "Check", "label": "Verify" }
      ]
    },
    {
      "key": "deployment-plans",
      "component": "structure",
      "cards": [
        [{ "key": "cloud", "icon": "Globe2", "label": "Cloud API" }],
        [
          { "key": "local", "icon": "Database", "label": "Local model" },
          { "key": "hybrid", "logo": "openai", "label": "Hybrid" }
        ]
      ]
    }
  ],
  "clips": [
    {
      "speech": "咨询顾问花了大量时间整理材料，客户的问题却**依然没有解决**。团队试着用 AI 加速，结果交付结构更加混乱。**只要结果可靠，他们仍愿意付费**。",
      "shots": [
        { "component": "story", "key": "buyer-pain-story", "spot": "buyer-neutral" },
        { "component": "story", "key": "buyer-pain-story", "spot": "delivery-strained" },
        {
          "component": "story",
          "key": "buyer-pain-story",
          "spot": "buyer-confident",
          "bubble": "可靠结果值得付费。"
        }
      ]
    },
    {
      "speech": "AI 浏览器自动化不是魔法，而是**观察、行动和验证**组成的工程闭环。",
      "shots": [
        { "component": "text-typing", "text": "Observe. Act. Verify." },
        {
          "component": "flow",
          "key": "browser-agent-flow",
          "spot": "observe"
        }
      ]
    },
    {
      "speech": "模型先读取页面，再规划步骤，调用工具，最后检查结果。**失败就重试**。",
      "shots": [
        {
          "component": "flow",
          "key": "browser-agent-flow",
          "spot": "verify"
        },
        { "component": "meme", "keytext": "wojak-npc" }
      ]
    },
    {
      "speech": "演示任务重试 **3 次**，调用成本从 1k 增长到 **5k**。",
      "shots": [
        { "component": "rolling-number", "number": 3, "label": "重试次数" },
        { "component": "linechart", "linechart": ["1k", "2k", "3k", "5k"] },
        {
          "component": "meme",
          "keytext": "expensive-shock"
        }
      ]
    },
    {
      "speech": "团队可以选择云端、本地或**混合方案**，再由人类批准敏感操作。",
      "shots": [
        {
          "component": "structure",
          "key": "deployment-plans",
          "spot": "hybrid"
        },
        { "component": "meme", "keytext": "expensive-shock" }
      ]
    }
  ]
}
```

<!-- CREATOR:FULL_VIDEO:END -->
