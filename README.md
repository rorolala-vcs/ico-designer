# ico-designer

为 RorolalaDesktop 制作的声明式图标设计器。每个图标是一份 TOML，编辑器负责可视化调整，CLI 负责把 TOML 增量渲染为 `artifact/*.png`。

## 环境与安装

- Node.js `>= 20.3`
- `sharp` 会安装对应平台的原生二进制

```bash
npm install
```

## 快速开始

```bash
npm run editor      # 打开可视化编辑器，默认 http://127.0.0.1:5173/
npm run generate    # 增量生成 artifact/*.png
npm run new -- my-icon
npm run list
```

也可以直接使用 CLI：

```bash
node src/cli.js editor --port 5174 --open
node src/cli.js generate --force
node src/cli.js generate tree
```

## 目录结构

```
res/{category}/base|id|efx.png   # 类别素材（也支持 SVG）
configs/{name}.toml              # 图标配置
configs/{name}/                  # 该配置的贴画 / 图案素材（PNG、SVG）
configs/{name}/art/{art}.toml    # 网格 SVG 绘制器的源文件
artifact/{name}.png              # 生成结果
artifact/.manifest.json          # 增量构建指纹
src/templates/                   # 新建配置时复制的默认素材
src/editor/renderer.js           # 浏览器 Canvas 实时预览
src/editor/color-picker.js       # 自定义取色器
src/editor/art-studio.js         # 全屏网格绘制器
src/lib/shapes.js                # 基本形状库
src/lib/art.js                   # 网格 TOML / SVG 生成与缓存
```

- `res/` 下每个子目录都是一种类别，例如 `doc-base`、`folder-base`、`pack-base`。
- 如果某个类别缺少素材，会回退到 `res/doc-base/`。
- `configs/tree/` 中的 `Park.svg`、`dots.svg` 分别是默认图标贴画和示例平铺图案。

## 叠加逻辑

1. `base` 位于最底层，提供形状与透明度。
2. 用 `id` 图划分着色区域：红色通道 → `RedId`，绿色通道 → `GreenId`，蓝色通道 → `BlueId`。同一像素的通道比例会混合，抗锯齿边缘不会出现硬边。
3. 按 ID 的着色方式填充这些区域。
4. 以 Photoshop 的 **Overlay（叠加）** 混合模式叠加半透明 `efx`：暗部更暗、亮部更亮，同时保留底层色相，完成高光、描边和阴影。
5. 从下到上依次绘制 `stickers` 贴画（贴画使用普通 alpha 合成，不参与 efx 的叠加混合）。

`doc-base` 中 `GreenId` 是主色（纸张主体），`BlueId` 是辅助色（折角）。

## TOML 参考

```toml
schema = 1
category = "doc-base"   # doc-base / folder-base / pack-base / res/ 下的目录名
size = 512              # 输出边长，16..4096

[ids.RedId]
type = "solid"
color = "#d92b2b"

[ids.BlueId]
type = "solid"
color = "#1926d2"

[ids.GreenId]
type = "linear"
angle = 90
stops = [
  { offset = 0, color = "#1976d2" },
  { offset = 1, color = "#0a3d91" },
]

[[stickers]]
kind = "icon"
source = "Park"      # configs/{name}/ 下的素材名，可省略扩展名
x = 0.5
y = 0.53
scale = 0.62
color = "#ffffff"
recolor = true

[stickers.stroke]
enabled = false
color = "#ffffff"
width = 0.012

[stickers.shadow]
enabled = true
color = "#000000"
opacity = 0.35
blur = 0.03
dx = 0
dy = 0.012
```

### 颜色 ID

三个 ID 始终会被规范化，缺省时使用内置默认值。每个 ID 支持四种着色方式：

| `type`    | 字段                                      | 说明                                |
| --------- | ----------------------------------------- | ----------------------------------- |
| `solid`   | `color`                                   | 纯色                                |
| `linear`  | `angle`, `stops`                          | 线性渐变。`0°` 左→右，`90°` 上→下   |
| `radial`  | `cx`, `cy`, `radius`, `stops`             | 径向渐变，圆心与半径按画布归一化    |
| `conic`   | `angle`, `cx`, `cy`, `stops`              | 环绕渐变。`0°` 从正上方开始，顺时针 |
| `pattern` | `source`, `scale`, `offset_x`, `offset_y` | 用 `configs/{name}/` 素材平铺       |

`stops` 是 `{ offset = 0..1, color = "#rrggbb" }` 数组。`scale` 是图案块相对画布的大小（`0.25` 表示约占四分之一）。图案的透明区域会露出白色基层。

### 贴画

```toml
[[stickers]]
kind = "text"
text = "Hello"          # 仅可打印 ASCII
font = "Segoe UI"       # 系统字体名，编辑器提供下拉列表
weight = 700
x = 0.5
y = 0.82
scale = 0.16            # 文本：字号相对画布；图标：最长边相对画布
color = "#ffd166"
```

公共字段：

| 字段                   | 说明                                          |
| ---------------------- | --------------------------------------------- |
| `kind`                 | `icon` 或 `text`                              |
| `x`, `y`               | 中心位置，按画布归一化，可超出 `0..1`         |
| `offset_x`, `offset_y` | 在 `x/y` 上额外偏移，同样归一化               |
| `scale`                | 图标为最长边 / 画布；文本为字号 / 画布        |
| `rotation`             | 旋转角度                                      |
| `opacity`              | `0..1`                                        |
| `color`                | 图标重着色颜色或文本颜色                      |
| `recolor`              | 仅图标：是否用 `color` 替换原色（保留透明度） |

描边与阴影都写在贴画的子表里：

| 子表              | 字段                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `stickers.stroke` | `enabled`, `color`, `width`（画布比例）, `opacity`                |
| `stickers.shadow` | `enabled`, `color`, `opacity`, `blur`, `dx`, `dy`（均为画布比例） |

图标素材会同时查找 PNG、SVG、WebP、JPEG、AVIF。编辑器顶部的贴画按钮会从当前 `configs/{name}/` 里挑选素材。若同一名字同时存在 PNG 与 SVG，编辑器会把带扩展名的完整文件名写入配置，以免歧义。

### 新建配置默认值

```toml
category = "doc-base"
BlueId  = 纯色 #1926d2
GreenId = #1976d2 向下渐变到 #0a3d91
贴画    = 一个白色 Park 图标
```

## 网格 SVG 绘制器（Art Studio）

点击顶部工具栏的网格按钮，或按 `A` 打开。需要先加载一个图标配置。

- 画布支持 `8 × 8` 到 `256 × 256` 的矩形网格，宽高可分别设置，也提供常用尺寸预设。
- 右侧形状面板按 Blocks / Triangles / Circles 分组，当前内置 51 种基本型：整格、半格、四分之一格、楼梯、斜切三角、朝内/朝外三角、等腰三角、不同直径圆、半圆、四分之一圆、圆环、菱形、十字、条形等。
- 画笔颜色使用自定义取色器（支持透明度），并提供常用色板。
- 左键放置、右键移除；按住拖动可以连续绘制/擦除。悬停时会用半透明幽灵显示将要放置的形状和范围。
- `R` 顺时针旋转画笔 90°，`F` 水平镜像画笔；顶部的 R/F 按钮也可用。
- 滚轮缩放，中键拖动平移；按住空格 + 左键也可以平移。
- `Ctrl+Z` / `Ctrl+Shift+Z` 撤销/重做，画布下方也有按钮。
- 支持多个 art 文件，左侧列表新建/切换/删除；尺寸变化会裁剪并可通过撤销恢复。
- 所有修改自动保存到 `configs/{config}/art/{name}.toml`。

### Art TOML 格式

```toml
width = 16
height = 16
rows = [
  "..00..",
  "001100",
]

[[styles]]
shape = "tri-in-top"
rotation = 90
mirror = true
color = "#1976d2"
```

每个格子用两位十六进制数表示 `[[styles]]` 中的索引，`..` 表示空格；行尾的空格可以省略。相同的形状/旋转/镜像/颜色会复用一个 style。颜色支持 `#rrggbb` 和 `#rrggbbaa`。

### 在图标中引用

图标 TOML 可以直接按名字引用 art：

```toml
[[stickers]]
kind = "icon"
source = "art/demo"   # 或 "art/demo.toml"
recolor = false       # 保留 art 的多色；true 会统一着色

[ids.GreenId]
type = "pattern"
source = "art/demo"
scale = 0.5
```

编辑器的素材选择器会把 `art/*.toml` 与 PNG/SVG 一起列出。服务端按需把网格 TOML 转成 SVG 并缓存，最终产物仍由 Node 渲染器生成。要添加新形状，在 `src/lib/shapes.js` 中写一个 `0..1` 坐标系内的路径即可，绘制器和渲染器会自动使用。

## 编辑器

- 主预览由浏览器 Canvas 实时绘制，修改颜色、渐变、贴画时不再请求服务端渲染，拖动和调色是即时的。左侧缩略图和最终 `artifact/*.png` 仍由 Node 渲染器生成，作为产物的最终依据。
- 左侧胶片栏展示所有配置，点击即可切换，`[` / `]` 或 `J` / `K` 快速前后切换。
- 右侧分区依次是类别、三个颜色 ID、当前 ID 的着色方式、贴画。
- 所有修改自动保存到 `configs/*.toml`；保存状态显示在右上角。
- 点击大色块、颜色小方块或渐变色标打开自定义取色器：SV 明度/饱和度面板、色相条、透明度条、Hex 输入和预设色板。拖动即可实时生效，`Esc` 撤销本次取色。
- 预览图上的黑点表示当前贴画中心。拖拽移动，滚轮缩放，`Shift` + 滚轮旋转，`Alt` + 滚轮改透明度；双击回到中心。
- `E` 打开原始 TOML 编辑器。可视化保存会按规范格式重写文件，手写注释不会保留；需要保留注释时使用原始 TOML 编辑器保存。
- `G` 增量生成，`Shift + G` 强制全部重新生成。

实时预览与最终 PNG 使用两套绘制实现（Canvas 与 sharp/SVG），在字体度量、滤镜/描边边缘等细节上可能有极细微差异；需要像素级确认时请以生成的产物为准。网格 art 的形状路径是共享的，差异主要来自抗锯齿。

### Art Studio 快捷键

| 操作            | 按键                         |
| --------------- | ---------------------------- |
| 放置 / 移除     | 左键 / 右键（可拖动）        |
| 旋转 / 镜像画笔 | `R` / `F`                    |
| 缩放 / 平移     | 滚轮 / 中键拖动或空格 + 左键 |
| 撤销 / 重做     | `Ctrl+Z` / `Ctrl+Shift+Z`    |
| 关闭            | `Esc`                        |

快捷键：

| 操作                          | 按键                       |
| ----------------------------- | -------------------------- |
| 上一个 / 下一个配置           | `[` `]` 或 `J` `K`         |
| 选择 RedId / BlueId / GreenId | `1` `2` `3`                |
| 移动贴画                      | 方向键（`Shift` 加大步长） |
| 旋转贴画                      | `Alt` + `←` `→`            |
| 打开取色器                    | 点击色块 / 色标            |
| 取色器撤销                    | `Esc`                      |
| 新建 / 复制 / 删除配置        | `N` / `D` / `Shift+Delete` |
| 编辑原始 TOML                 | `E`                        |
| 打开 Art Studio               | `A`                        |
| 生成 / 强制生成               | `G` / `Shift+G`            |
| 保存 / 切换背景               | `Ctrl+S` / `B`             |
| 删除当前贴画                  | `Delete`                   |
| 帮助                          | `?`                        |

## 增量生成

`npm run generate` 会读取 `artifact/.manifest.json`，根据以下内容判断是否需要重新渲染：

- TOML 文件内容
- 渲染器版本
- 类别 `base/id/efx` 素材的修改时间与大小
- 图案和图标贴画的修改时间与大小

未变化的配置会跳过；`--force` 忽略指纹。删除配置时，对应的 `artifact/{name}.png` 也会被删除。

## 系统字体

编辑器启动时枚举系统字体：

- Windows：PowerShell / `System.Drawing`
- Linux / macOS：`fc-list`
- 失败时使用内置字体候选

列表缓存在 `.cache/fonts.json`，有效期 24 小时。
