# WordForge 视觉配色系统

本轮配色采用 **Sage Neutral** 方案：以低饱和森林绿作为主色，配合中性纸白/炭黑背景和克制蓝色信息色。目标是让 WordForge 从“霓虹感工具界面”转为更简约、稳定、现代的学习产品界面。

## 设计原则

- **语义化令牌**：页面不直接依赖具体颜色，而是使用 `bg`、`panel`、`text`、`muted`、`line`、`accent` 等语义 token。
- **浅深模式同源**：浅色和深色使用同一套 token 名称，只替换 token 值，保证组件层级一致。
- **低饱和主色**：主色选用森林绿/鼠尾草绿，表达学习、成长和稳定，避免高饱和荧光绿。
- **弱化毛玻璃**：深色模式取消大面积 `backdrop-filter` 和背景光斑，改为实体层级与清晰遮罩。
- **辅助色克制**：蓝色只用于阅读高亮、信息提示和辅助反馈，不作为大面积主色。

## 深色模式 Tokens

| Token | 用途 | 色值 |
| --- | --- | --- |
| `--bg` | 页面背景 | `#101511` |
| `--panel` | 主面板 | `#171e19` |
| `--panel-raised` | 浮层/高层级面板 | `#202820` |
| `--card` | 卡片/输入组背景 | `#1b231d` |
| `--card-hover` | 卡片悬停 | `#223025` |
| `--text` | 主文本 | `#eef3ec` |
| `--muted` | 次文本 | `#a7b1a8` |
| `--line` | 分割线/弱边框 | `#303a33` |
| `--accent` | 主强调色 | `#79c99a` |
| `--accent-strong` | 强主色/按钮渐变 | `#4ea876` |
| `--accent-alt` | 辅助信息色 | `#8ab7e6` |
| `--danger` | 危险/删除 | `#e07180` |

## 浅色模式 Tokens

| Token | 用途 | 色值 |
| --- | --- | --- |
| `--bg` | 页面背景 | `#f5f7f2` |
| `--panel` | 主面板 | `#ffffff` |
| `--panel-raised` | 浮层/高层级面板 | `#f7faf5` |
| `--card` | 卡片/输入组背景 | `#fbfcf9` |
| `--card-hover` | 卡片悬停 | `#f1f6ef` |
| `--text` | 主文本 | `#18201a` |
| `--muted` | 次文本 | `#667267` |
| `--line` | 分割线/弱边框 | `#e1e8de` |
| `--accent` | 主强调色 | `#2f7d52` |
| `--accent-strong` | 强主色/按钮渐变 | `#246640` |
| `--accent-alt` | 辅助信息色 | `#3f6f9f` |
| `--danger` | 危险/删除 | `#b94355` |

## 使用方式

组件层尽量只使用语义 token：

```css
.panel {
  background: var(--panel);
  border: 1px solid var(--panel-border);
}

.primary-button {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
}
```

如果需要透明态，优先使用对应 RGB token：

```css
background: rgba(var(--accent-rgb), 0.12);
border-color: rgba(var(--accent-rgb), 0.28);
```

这样可以保证浅色/深色模式下透明态仍然跟随主色系统。
