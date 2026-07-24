# ADR-0002：可停靠工作区与多窗口模型

- 状态：Accepted
- 范围：论文、Reading Brief、Chat、翻译结果、批注和论文多视图

## 决策

将布局建模为可序列化的 LayoutTree，而不是固定的左右栏。

核心概念：

- PanelInstance：一个具体内容面板
- StackNode：同一窗口中的标签集合
- SplitNode：上下或左右拆分
- WorkspaceWindow：应用内部工作区窗口
- NativeWindow：桌面系统窗口
- WindowRegistry：系统窗口与面板实例登记

## 影子拖动语义

拖动面板或 Chat 标签时显示内容缩小的 ghost preview，并在释放前预览最终布局。

- 顶层面板中央：预览互换位置
- 标签栏：合并为标签
- 面板边缘：创建 SplitNode
- 工作区外：桌面端创建 NativeWindow
- 语义不明确：显示“互换位置 / 合并为标签”选择

所有布局操作都必须是可撤销的领域命令。

## 平台能力

- Web：支持工作区内拆分；独立窗口受浏览器能力限制
- Desktop：支持 Tauri 原生独立窗口
- Tablet：支持触摸拆分、互换和视图打开
- Phone：使用视图栈、抽屉和操作菜单表达相同语义，不伪造桌面系统窗口

## 约束

- 面板位置变化不能改变内容状态
- PaperView 的滚动位置、缩放和选区独立保存
- ChatSession 的历史和模型选择跟随面板实例
- 第一版允许完整核心操作，但布局树必须可序列化、可恢复和可撤销
- 底层 docking engine 可采用成熟实现；业务层保留自己的面板语义和命令
