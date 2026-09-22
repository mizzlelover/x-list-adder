# X List Adder

一个 Chrome 扩展，让你在 X (Twitter) 上把任意用户一键加进自己的 List。

A Chrome extension that adds any X (Twitter) user to your List in one click.

<img src="icon128.png" width="72" alt="icon">

## 功能

- **资料卡片一键加 List** — 鼠标悬停任意用户的资料卡片，按钮区会多出一个「+ List」，点击选择目标分组即可加入，成功后有提示。
- **侧边栏快捷入口** — 在 X 左侧导航栏最顶部固定一个「我的 Lists」入口，点开即可选择分组，直接跳转到 X 原生的 List 页面。不受 X 把 Lists 菜单收进二级目录的影响。

## 安装

本扩展未上架 Chrome 应用商店，以开发者模式加载：

1. 下载或克隆本仓库到本地
2. 打开 `chrome://extensions`
3. 打开右上角的「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本仓库目录
5. 打开并登录 x.com

## 使用

首次使用需要先配置分组：

1. 点击工具栏上的扩展图标
2. 点击「从 X 同步我的 Lists」自动拉取你拥有的全部分组，也可以粘贴 List 链接手动添加
3. 之后悬停任意用户资料卡片，点「+ List」选择分组即可

## 工作原理

- content script 监听页面上的资料卡片（`data-testid="HoverCard"`），解析出用户名
- 用户 ID 直接从关注按钮的 `data-testid` 读取，无需额外请求
- 通过 X 网页端自身的接口完成加入操作，复用浏览器登录态

## 注意事项

- 使用的是 X 网页端的内部接口，**不是官方公开 API**。X 前端改版后扩展可能失效，届时需要更新代码并重新加载扩展。
- 请合理使用，避免高频批量操作。
- 仅供个人学习与自用。

## License

[MIT](LICENSE)
