# Chrome MCP 工具目录

本目录说明当前服务提供的工具用途，便于选择调用入口。工具数量和参数可能随上游版本变化；实际调用前始终执行 `tools/list`，以返回的名称和 `inputSchema` 为准。

## 页面、标签页与窗口

| 工具 | 用途 |
|:---|:---|
| `get_windows_and_tabs` | 列出当前所有浏览器窗口和标签页。 |
| `chrome_navigate` | 打开 URL、刷新页面，或在历史记录中前进/后退。 |
| `chrome_create_tab` | 新建标签页，可指定 URL、窗口、前台/后台和固定状态。 |
| `chrome_close_tabs` | 关闭一个或多个标签页。 |
| `chrome_switch_tab` | 切换当前操作的标签页。 |
| `chrome_get_tab_url` | 快速获取标签页的 URL、标题、ID 和 favicon。 |
| `chrome_read_page` | 读取当前视口可见元素的无障碍树，返回可复用的元素 ref。 |
| `chrome_screenshot` | 截取页面或元素截图；普通查看优先使用 `chrome_read_page` 或 `chrome_computer` 的 screenshot action。 |
| `chrome_computer` | 使用鼠标、键盘与截图动作进行综合交互；点击前优先用 `chrome_read_page` 获取 ref。 |
| `chrome_javascript` | 在标签页中执行 JavaScript 并返回结果；输出默认脱敏并截断。 |

## 定位、点击、输入与等待

| 工具 | 用途 |
|:---|:---|
| `chrome_locate_element` | 按 ref、CSS/XPath、文本、ARIA、data-testid 或 name 定位元素，并返回可操作的 ref、坐标和信息。 |
| `chrome_get_interactive_elements` | 查找页面上的可点击和可交互元素，可按文本、CSS 或元素类型过滤。 |
| `chrome_click_element` | 点击元素，支持 marker、CSS、XPath、无障碍 ref 或坐标。 |
| `chrome_click_and_wait` | 点击 CSS 选中的元素，并等待另一元素达到指定状态。 |
| `chrome_find_and_click` | 按候选 CSS、XPath 或文本依次查找并点击第一个可见可用元素。 |
| `chrome_fill_or_select` | 填写 input/textarea，或选择 select、checkbox、radio。 |
| `chrome_get_form_value` | 读取表单控件的实际 DOM value，适用于 React/Vue 受控表单。 |
| `chrome_keyboard` | 发送文本、单键或组合键到指定元素或当前焦点。 |
| `chrome_hover` | 将鼠标悬停在元素上，用于 dropdown、tooltip 或 submenu。 |
| `chrome_wait` | 等待 DOM、JavaScript 条件、DOM 变化或网络事件满足；超时返回状态而非直接抛错。 |
| `chrome_expand_section` | 展开折叠区域，并等待指定内容出现。 |
| `chrome_request_element_selection` | 元素自动定位失败时，请用户在页面上手动选择元素并返回兼容 ref。 |
| `chrome_handle_dialog` | 接受、取消或填写 JavaScript alert/confirm/prompt/beforeunload 对话框。 |

## 页面内容与结构化提取

| 工具 | 用途 |
|:---|:---|
| `chrome_get_page_text` | 用 Readability 提取文章正文及标题、摘要、作者、站点等元数据。 |
| `chrome_get_web_content` | 提取网页可见 HTML 或文本。 |
| `chrome_extract` | 用 CSS 选择器提取结构化字段、嵌套数据、表格或 iframe 内容。 |
| `search_tabs_content` | 在指定的一个或多个标签页可读内容中做语义搜索。 |
| `chrome_spa_fetch` | 打开 SPA，等待 JavaScript 渲染、滚动触发懒加载并提取最终文本。 |
| `chrome_list_frames` | 列出页面 iframe/frame，供后续 frameId 作用域操作。 |
| `chrome_get_element_info` | 查询元素 attributes、computed styles 和 bounding rect。 |
| `chrome_get_scroll_state` | 获取页面或滚动容器的 y、maxY、atTop、atBottom 状态。 |
| `chrome_scroll` | 滚动页面或嵌套容器，可按像素、方向、顶部/底部或元素定位。 |

## 批量采集与数据处理

| 工具 | 用途 |
|:---|:---|
| `chrome_scan_for_section` | 滚动查找目标区域，可选择向上复扫。 |
| `chrome_paginate_extract` | 抽取当前页、点击下一页，并在内容变化后继续分页。 |
| `chrome_extract_records` | 从卡片抽取指定原始字段，并按文本规则排除记录。 |
| `chrome_extract_review_summary` | 提取商品详情页 Reviews 区域的商品 ID、评分和评论数；评论数明确为 0 时返回可终止结果。 |
| `chrome_crawl_links` | 按深度和节点上限递归访问页面链接，返回成功页面和部分失败结果。 |
| `chrome_extract_thread` | 从主内容区域提取评论或回复，支持滚动加载、嵌套条目排除和匹配文本停止。 |
| `collect_virtual_list` | 从动态或虚拟列表中滚动采集去重记录，支持停滞判断和回扫。 |
| `collect_virtual_lists` | 在多个标签页或窗口并发采集虚拟列表，返回各目标结果和失败原因。 |
| `chrome_select_all_items` | 滚动懒加载/虚拟列表并逐项勾选 checkbox，实现可靠的全选。 |
| `detect_empty_state` | 根据选择器和文本标记判断有内容、空状态或加载未知。 |
| `merge_records` | 按身份字段和数据源优先级合并纯数据，不读取浏览器状态。 |
| `wait_extract_response` | 导航或点击后等待指定网络响应，可核验 HTTP 结果并按 JSONPath 提取记录。 |
| `chrome_batch` | 按顺序执行最多 50 个浏览器工具调用，可统一使用 Profile 和动作节奏。 |

## 网络、控制台与诊断

| 工具 | 用途 |
|:---|:---|
| `chrome_network_request` | 在浏览器上下文发起网络请求，携带 Cookie 等浏览器信息。 |
| `chrome_network_capture` | 开始或停止网络捕获，可选抓取响应体；默认模式更轻量。 |
| `chrome_block_images` | 阻止页面图片请求，适合导航/采集前减少流量。 |
| `chrome_block_resources` | 按资源类型或 URL 模式拦截请求。 |
| `chrome_console` | 读取控制台输出，支持一次性快照或持久缓冲。 |
| `chrome_error_logs` | 读取或清除浏览器插件保留的原始错误日志，用于桌面端错误诊断。 |
| `chrome_diagnostic_snapshot` | 返回截图、DOM、控制台和网络摘要组成的诊断快照。 |
| `capture_debug_bundle` | 将失败现场的截图、DOM、控制台和脱敏网络摘要保存到下载目录。 |
| `chrome_proxy_diagnostics` | 读取代理配置和 Chrome 接管状态，可测试代理出口，不返回账号密码。 |
| `chrome_proxy_rotate` | 轮换代理会话并重载异常标签页；需要已启用代理。 |

## Cookie、书签、历史与页面存储

这些工具会读写浏览器数据，删除或写入前应确认目标范围。

| 工具 | 用途 |
|:---|:---|
| `chrome_history` | 搜索 Chrome 浏览历史。 |
| `chrome_bookmark_search` | 按标题或 URL 搜索书签。 |
| `chrome_bookmark_add` | 添加书签，可指定文件夹。 |
| `chrome_bookmark_delete` | 按 ID 或 URL 删除书签。 |
| `chrome_cookie_get` | 按 URL、域名、名称或存储分区读取 Cookie。 |
| `chrome_cookie_set` | 设置 Cookie，可指定 HttpOnly、Secure、SameSite、路径和过期时间。 |
| `chrome_cookie_delete` | 按 URL 和名称删除 Cookie。 |
| `chrome_storage_get` | 读取页面 localStorage/sessionStorage。 |
| `chrome_storage_set` | 写入页面 localStorage/sessionStorage，值按 JSON 序列化。 |
| `chrome_storage_delete` | 删除页面 localStorage/sessionStorage 键。 |

## 文件、富文本与发布

| 工具 | 用途 |
|:---|:---|
| `chrome_upload_file` | 向网页文件输入控件上传本地文件。 |
| `chrome_paste_text` | 向富文本编辑器合成粘贴多段文本，适合 Draft.js、知乎、Medium 等场景。 |
| `chrome_paste_image` | 将本地图片或图片数据合成 paste 事件粘贴到 input、textarea 或 contenteditable。 |
| `chrome_handle_download` | 等待下载完成并返回文件名、URL、状态和大小。 |
| `chrome_print_to_pdf` | 用 CDP 将页面打印为 PDF，支持 CSS 或自定义纸张尺寸。 |
| `chrome_post_to_x` | 在已登录的 X/Twitter 页面发布文本；结果为 published、failed 或 unknown，unknown 不自动重试。 |
| `chrome_userscript` | 创建、查询、启停、更新、删除、导出用户脚本或向脚本发送命令；属于高风险工具。 |
| `chrome_gif_recorder` | 录制标签页活动为 GIF，支持固定帧率或跟随操作自动采集。 |

## Profile、任务状态与性能

| 工具 | 用途 |
|:---|:---|
| `chrome_profile` | 创建、启动、停止、删除、查看或诊断隔离浏览器 Profile。 |
| `chrome_task_context` | 创建隔离无痕任务窗口，并保存标签页和调用方定义的抓取状态。 |
| `resume_tab_task` | 保存、读取或清除普通标签页的调用方任务状态，不读取 Cookie。 |
| `chrome_scoped_action` | 在语义作用域内执行点击、抽取或分页，支持 Shadow DOM 和 iframe。 |
| `performance_start_trace` | 开始页面性能追踪，可自动刷新或定时停止。 |
| `performance_stop_trace` | 停止页面性能追踪记录。 |
| `performance_analyze_insight` | 返回最近性能追踪的轻量摘要；深入洞察需使用原生 DevTools 追踪引擎。 |

## 常用选择路径

| 任务 | 推荐调用顺序 |
|:---|:---|
| 打开并阅读网页 | `chrome_navigate` → `chrome_read_page` 或 `chrome_get_page_text` |
| 找按钮并点击 | `chrome_read_page` → `chrome_click_element`；定位困难时用 `chrome_locate_element` |
| 填写表单 | `chrome_read_page`/`chrome_locate_element` → `chrome_fill_or_select` → `chrome_get_form_value` 验证 |
| 抽取商品/表格 | `chrome_extract`；多页使用 `chrome_paginate_extract`，虚拟列表使用 `collect_virtual_list` |
| 递归抓取同源链接 | `chrome_crawl_links`；设置深度、节点上限和字段提取，接受部分失败结果 |
| 提取评论/回复 | `chrome_extract_thread`；适合评论区、回复串和滚动加载内容 |
| 提取商品评论摘要 | `chrome_extract_review_summary`；评论数明确为 0 时停止，不要继续换入口或重试 |
| 操作 SPA | `chrome_spa_fetch`；需要鼠标键盘时用 `chrome_computer` |
| 点击后确认后端成功 | `wait_extract_response` |
| 元素定位多次失败 | `chrome_request_element_selection`，请求用户人工选取 |
| 调试页面异常 | `chrome_console` / `chrome_error_logs` / `chrome_network_capture` → `chrome_diagnostic_snapshot` 或 `capture_debug_bundle` |

所有工具调用都应使用 `tools/list` 返回的最新参数；涉及发布、删除、Cookie、存储、用户脚本、文件上传或 Profile 管理时，先确认目标和副作用。
