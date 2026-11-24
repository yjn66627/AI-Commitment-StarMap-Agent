// Conservative updater discovery. No executable payload is downloaded or run.
// Public GitHub Releases is an untrusted source for executable code until a
// signed installer/update manifest and publisher identity are established.
const BASE='https://github.com/yjn66627/AI-Commitment-StarMap';
const LATEST='https://api.github.com/repos/yjn66627/AI-Commitment-StarMap/releases/latest';
const HOST='https://github.com';
export function semverTuple(v){
  if(typeof v!=='string')return null;
  const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.-]{1,40})?$/.exec(v);
  return m?m.slice(1,4).map(Number):null;
}
export function newerThan(candidate,current){
  const a=semverTuple(candidate),b=semverTuple(current);if(!a||!b)return false;
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}
  return false;
}
export function parseRelease(raw,current){
  if(!raw||typeof raw!=='object'||raw.draft||raw.prerelease)throw Error('RELEASE_NOT_STABLE');
  const tag=raw.tag_name;
  if(typeof tag!=='string'||!/^v?\d+\.\d+\.\d+$/.test(tag))throw Error('RELEASE_TAG_INVALID');
  const target=BASE+'/releases/tag/'+encodeURIComponent(tag);
  if(raw.html_url!==target)throw Error('RELEASE_ORIGIN_INVALID');
  const details=typeof raw.body==='string'?raw.body.slice(0,1600):'';
  return {version:tag.replace(/^v/,''),available:newerThan(tag,current),url:target,notes:details,installerStatus:'manual-release-only'};
}
export async function queryRelease({fetchImpl=fetch,currentVersion='1.5.0',timeoutMs=8000}={}){
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const res=await fetchImpl(LATEST,{redirect:'error',signal:ctrl.signal,headers:{'accept':'application/vnd.github+json','user-agent':'AICommitmentStarMap-updater/1.5'}});
    if(!res.ok)throw Error('RELEASE_HTTP_'+res.status);
    const type=res.headers?.get?.('content-type')||'';
    if(type&&!/\bjson\b/i.test(type))throw Error('RELEASE_CONTENT_TYPE');
    const raw=await res.text();if(Buffer.byteLength(raw)>150_000)throw Error('RELEASE_TOO_LARGE');
    return parseRelease(JSON.parse(raw),currentVersion);
  }finally{clearTimeout(timer);}
}
export function verifiedReleaseUrl(url){
  if(typeof url!=='string'||url.length>260)return false;
  try{const parsed=new URL(url);return parsed.origin===HOST&&parsed.username===''&&parsed.password===''&&parsed.pathname.startsWith('/yjn66627/AI-Commitment-StarMap/releases/tag/')&&!parsed.search&&!parsed.hash&&/^\/yjn66627\/AI-Commitment-StarMap\/releases\/tag\/v?\d+\.\d+\.\d+$/.test(decodeURIComponent(parsed.pathname));}catch{return false;}
}
export function createReleaseManager({currentVersion='1.5.0',fetchImpl=fetch,openExternal=async()=>{},timeNow=()=>new Date().toISOString()}={}){
  let state={version:currentVersion,status:'idle',available:false,notes:'',url:null,lastChecked:null,installMode:'manual-verified-release'};
  let busy=null;
  return {
    status:()=>({...state}),
    check:async()=>{
      if(busy)return busy;
      busy=(async()=>{state={...state,status:'checking'};try{const info=await queryRelease({fetchImpl,currentVersion});state={...state,...info,status:'ready',lastChecked:timeNow()};}catch(e){state={...state,status:'error',available:false,url:null,notes:'',errorCode:e.name==='AbortError'?'UPDATE_CHECK_TIMEOUT':/^RELEASE_/.test(e.message)?e.message:'UPDATE_CHECK_FAILED',lastChecked:timeNow()};}finally{busy=null;}return {...state};})();
      return busy;
    },
    open:async()=>{
      if(state.status!=='ready'||!state.available||!verifiedReleaseUrl(state.url))throw Error('UPDATE_RELEASE_UNVERIFIED');
      await openExternal(state.url);return {opened:true};
    },
  };
}
