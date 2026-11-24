import {validateAssets} from './gesture-assets.mjs';
const result=await validateAssets();
if(!result.ok){console.error('离线手势识别资源不完整：',result.reason,result.file||'');console.error('请先执行 npm run prepare:gestures；禁止在缺少资源时生成发行安装包。');process.exitCode=1;}
else console.log('MediaPipe本地资源校验通过，发行包不依赖运行时CDN。',result.details);
