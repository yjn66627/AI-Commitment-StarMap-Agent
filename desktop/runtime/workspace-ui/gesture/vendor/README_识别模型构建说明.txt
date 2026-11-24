此目录只存放从官方发布源取得、在构建时经过SHA-256校验的MediaPipe识别资源。
开发/打包时依次执行：npm install、npm run prepare:gestures、npm run check、npm run make:win。
当前源码ZIP不含模型和WASM二进制；构建脚本必须先将其离线打入安装器，否则禁止输出安装包。
模型来自Google MediaPipe Hand Landmarker；哈希由 scripts/gesture-assets.mjs 锁定。
摄像头画面、用户项目和API Key不会用于模型下载，也不会传输给Google。
