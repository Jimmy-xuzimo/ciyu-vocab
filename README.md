# 词屿 · 英语单词学习

词屿是一款支持手机、平板和桌面浏览器的英语词汇学习应用。当前版本提供初中、高中、大学四级、大学六级、雅思、考研、托福和 SAT 八本词书；它支持新词卡片、每日测验、已学词复习、词典搜索和学习记录导入导出。

## 学习方式

- 所有词书共享单词学习进度。相同拼写的词条在切换词书后不会再次作为新词出现。
- 新词默认每天 20 个；已学复习默认每天随机抽取 30 个，并优先复习到期词。可在设置中调整目标。
- 测验从当前词书随机抽取词条；复习题仅从已经学过的词条中抽取。答题结果会更新复习间隔。
- 进度默认保存在当前设备浏览器中，可导出 JSON 并在另一台设备导入。当前没有账号或云端同步。
- 网页支持安装为 PWA，离线缓存应用与词库。Windows 提供 Electron 便携版；Android 使用 Capacitor 原生壳。

## 本地运行

要求 Node.js 22.12 或更高版本。

```sh
npm ci
npm run dev
```

打开终端输出的本地地址即可预览。常用检查：

```sh
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

构建完成后可通过 `npm run preview` 预览生产包。PWA 缓存包含应用文件和词库 JSON，首次安装需要下载约 8 MB 词库。

## Windows 桌面版

```sh
npm run desktop:build
```

便携版 `.exe` 输出到 `dist-electron/`。本地开发可运行 `npm run desktop:dev`；当前打包目标为 Windows x64。

## Android

先运行 `npm run build`，再运行：

```sh
npx cap sync android
```

使用 Android Studio 打开 `android/` 项目即可本地运行或构建 APK。APK 输出到 `android/app/build/outputs/apk/debug/`。正式签名、商店资料和公开发布尚未配置。

## 词库与许可

词书和数据来源、已知许可、合并规则及 PDF 分发限制见 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)。源代码许可证不自动覆盖第三方词库或用户 PDF 内容。公开发布前需确认两份 PDF 的再分发权利；若尚未确认，应省略对应 PDF 数据并重新生成词库。

## 项目网站

- 项目页：https://jimmy-xuzimo.github.io/gaokao-vocab/
- 网页应用：https://jimmy-xuzimo.github.io/gaokao-vocab/app/
- `npm run pages:build` 生成项目页和子路径网页应用，输出到 `dist-pages/`。
- 推送 main 后由 GitHub Actions 部署 Pages，同时构建 Windows 便携版和 Android 测试 APK。

## 界面偏好

默认跟随系统明暗，设置页可选择浅色、深色以及林间绿、海盐蓝、鸢尾紫、暖杏橙四种配色。高中与高考词表按规范化英文拼写合并；旧版高考词书选择自动迁移到高中，已学单词 ID 保留。
