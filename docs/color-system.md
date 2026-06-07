# WordForge 视觉配色系统

本轮配色采用 **Warm Sage** 微调方案：保留低饱和绿色带来的学习、成长和稳定感，同时把浅色模式的灰绿中性色提纯为干净暖白，把深色模式的橄榄黑收敛为更纯净的墨绿黑。目标是在“简约稳定”的基础上增加一点活力，并降低主按钮的突兀感。

## 设计原则

- **语义化令牌**：页面不直接依赖具体颜色，而是使用 `bg`、`panel`、`text`、`muted`、`line`、`accent` 等语义 token。
- **浅深模式同源**：浅色和深色使用同一套 token 名称，只替换 token 值，保证组件层级一致。
- **温和主色**：主色选用更明亮的鼠尾草绿/薄荷绿，表达学习、成长和稳定，避免高饱和荧光绿。
- **弱化毛玻璃**：深色模式取消大面积 `backdrop-filter` 和背景光斑，改为实体层级与清晰遮罩。
- **辅助色克制**：蓝色只用于阅读高亮、信息提示和辅助反馈，不作为大面积主色。
- **轻量行动按钮**：主按钮不再使用深绿渐变，改为柔和实体填充，浅色模式尤其避免深色按钮压住页面。

## 深色模式 Tokens

| Token | 用途 | 色值 |
| --- | --- | --- |
| `--bg` | 页面背景 | `#0f1713` |
| `--panel` | 主面板 | `#141f19` |
| `--panel-raised` | 浮层/高层级面板 | `#1a281f` |
| `--card` | 卡片/输入组背景 | `#18251e` |
| `--card-hover` | 卡片悬停 | `#213128` |
| `--text` | 主文本 | `#f3f7f1` |
| `--muted` | 次文本 | `#b4c2b7` |
| `--line` | 分割线/弱边框 | `#2b3c32` |
| `--accent` | 主强调色 | `#6fbd8f` |
| `--accent-strong` | 强主色/反馈色 | `#55a978` |
| `--accent-alt` | 辅助信息色 | `#7fb7e8` |
| `--danger` | 危险/删除 | `#e07886` |
| `--button-primary-bg` | 主按钮背景 | `#6fbd8f` |
| `--button-primary-text` | 主按钮文字 | `#07130d` |

## 浅色模式 Tokens

| Token | 用途 | 色值 |
| --- | --- | --- |
| `--bg` | 页面背景 | `#fbfaf4` |
| `--panel` | 主面板 | `#ffffff` |
| `--panel-raised` | 浮层/高层级面板 | `#fffefa` |
| `--card` | 卡片/输入组背景 | `#fffefa` |
| `--card-hover` | 卡片悬停 | `#f0f7ee` |
| `--text` | 主文本 | `#172019` |
| `--muted` | 次文本 | `#627067` |
| `--line` | 分割线/弱边框 | `#e3eadd` |
| `--accent` | 主强调色 | `#3f9f70` |
| `--accent-strong` | 强主色/反馈色 | `#2f7f57` |
| `--accent-alt` | 辅助信息色 | `#3f7fb3` |
| `--danger` | 危险/删除 | `#bd4658` |
| `--button-primary-bg` | 主按钮背景 | `#ccebd8` |
| `--button-primary-text` | 主按钮文字 | `#16452f` |

## 使用方式

组件层尽量只使用语义 token：

```css
.panel {
  background: var(--panel);
  border: 1px solid var(--panel-border);
}

.primary-button {
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}
```

如果需要透明态，优先使用对应 RGB token：

```css
background: rgba(var(--accent-rgb), 0.12);
border-color: rgba(var(--accent-rgb), 0.28);
```

这样可以保证浅色/深色模式下透明态仍然跟随主色系统。
