// Starts the real adapter for an external Chromium smoke test; test-only ephemeral token.
import {startDesktopService} from '../electron/desktop-service.mjs';
const service=await startDesktopService({env:{}});
const cookie=await service.signIn();
process.stdout.write(JSON.stringify({origin:service.origin,cookie:`${cookie.name}=${cookie.value}`})+'\n');
process.on('SIGTERM',()=>service.stop().then(()=>process.exit(0)));
process.on('SIGINT',()=>service.stop().then(()=>process.exit(0)));
