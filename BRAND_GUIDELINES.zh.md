# SecScan RedTeam 品牌规范

[English](BRAND_GUIDELINES.md) | 中文

本文件定义 SecScan RedTeam 品牌：菱形标志、字标、红色主题及其使用规则。本规范仅适用于 SecScan RedTeam 产品。第三方标志（Meta、Muse Spark 以及本产品所连接的服务）归各自所有者所有，不得作为 SecScan 的品牌素材呈现。

## 标志

产品标志是一个**菱形盾牌**：红色盾形轮廓呈尖端向下的菱形，内部为黑色，中心有一枚蓝色十字准星。它与应用图标（`apps/desktop/resources/icon.png`）为同一 artwork，规范矢量文件位于 [`docs/assets/diamond.svg`](docs/assets/diamond.svg)。

- 盾形轮廓使用 RedTeam 红渐变：顶部 `#F43F5E` 至底部 `#BE123C`。
- 内部为 Interior Black `#0B0F1A`。不得用红色、白色或照片填充内部。
- 十字准星为 Crosshair Blue `#38BDF8`。这是标志中唯一的蓝色；不得为迁就主题而改色。
- 在深色表面上，标志可直接置于背景之上。在浅色表面上，应将其置于 Ink Navy `#0D1526` 底板（圆角方形，与应用图标相同）之上——不得直接置于白色或浅色之上。

## 字标

产品名称写作 **SecScan RedTeam**：“SecScan”为一个词，两个 S 均大写；“RedTeam”为一个词，R 与 T 大写；两词之间一个空格。

- 在组合标志中，“SecScan”为白色或墨色，“RedTeam”为 RedTeam 红 `#F43F5E`。组合字体为 Montserrat（名称 700，标语 500）。
- 公司写作“SecScan”，产品写作“SecScan RedTeam”。产品呈现的评估/报告组合命名为 **Assay + Provenance**；这两个名称指产品的两半（评估引擎与证据记录），永不替代产品名称。
- 不得将名称写作“Sec Scan”“SecScan Red Team”，不得在文件名与包名之外写作“secscan-redteam”，也不得将名称翻译为其他文字。

## 红色主题

SecScan RedTeam 的视觉识别为**黑底红饰**：深红与近黑的表面、红色主强调色、白色与石板灰文字，Crosshair Blue 仅保留给标志与产品 UI 中的瞄准/选中强调。

| 令牌 | 值 | 用途 |
|---|---|---|
| RedTeam Red | `#E11D48` | 主强调、分隔线、激活状态 |
| 红色渐变 | `#F43F5E` → `#BE123C` | 标志、横幅图、标题强调 |
| Surface Black | `#0A0A0F` | 页面与面板背景 |
| Interior Black | `#0B0F1A` | 标志内部、内嵌面板 |
| Ink Navy | `#0D1526` | 图标底板、凸起表面 |
| Crosshair Blue | `#38BDF8` | 仅标志的十字准星与选中强调 |
| 文字 | `#F8FAFC` / `#CBD5E1` / `#8A94A6` | 深色底上的标题 / 正文 / 弱化文字 |

报告中的严重等级颜色保留其自身含义（critical/high/medium/low），不按品牌红色阶重新着色；报告的评级颜色必须始终可读作严重等级，而非装饰。

## 使用规则

- 标志四周留白至少等于十字准星的直径。最小渲染尺寸：单独标志 16 px，组合标志宽 120 px。
- 不得拉伸、旋转、描边、加阴影、动画化或改变标志的比例；不得将十字准星重绘为其他样式的准星；不得将标志置于繁杂图像之上。
- 产品截图与报告可按应用的实际渲染呈现标志。营销或文档图稿应源自 `docs/assets/diamond.svg` 与 `docs/assets/banner.svg`，而非重新绘制几何形状。
- 标志与字标仅标识 SecScan RedTeam。不得以暗示 Meta、Muse 或任何所连接服务为 SecScan RedTeam 背书的方式使用它们，也不得将其用于其他产品。

## 语调

SecScan RedTeam 的文档与产品文案陈述已证明之事及其证明方式：主张附带证据，限制坦率写明，任何内容都不得在手中收据支持范围之外被描述为已验证、已覆盖或安全。
