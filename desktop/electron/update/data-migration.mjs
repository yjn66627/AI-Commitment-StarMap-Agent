// One-way, read-only migration from the verified V1.4 workspace into the
// separately owned V1.5+ profile. Never overwrite a V1.5 workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {ProjectStore} from '../workspace/data-store.mjs';

export const DATA_ROOT_NAME='AICommitmentStarMap-Production';
export const DATA_MARKER='.starmap-owner-v15';
// Additional bounded candidates cover plausible Windows V1.4 installation identity overrides.
// No recursive D:/E: disk search; only the logged-in user's appData.
export const V14_NAMES=['AI承诺审计星图-智能体','AICommitmentStarMapV14','AICommitmentStarMap-V1.4','AI承诺审计星图-智能体-V1.4','AI承诺审计星图-智能体 V1.4','ai-commitment-audit-constellation-desktop'];

async function regularFile(file,limit){
  try{const st=await fs.lstat(file);if(!st.isFile()||st.size>limit)throw Error('MIGRATION_SOURCE_INVALID');return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function inspectEncryptedProfiles(raw){
  if(!raw)return;
  const p=JSON.parse(raw.toString('utf8'));
  if(!p||p.version!==1||!p.profiles||typeof p.profiles!=='object'||Array.isArray(p.profiles))throw Error('MIGRATION_KEY_SCHEMA_INVALID');
  for(const v of Object.values(p.profiles)){
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error('MIGRATION_KEY_SCHEMA_INVALID');
    if(v.secret!==null&&v.secret!==undefined&& (typeof v.secret!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.secret)))throw Error('MIGRATION_KEY_NOT_ENCRYPTED');
  }
}
async function writeExclusive(file,bytes){
  const temporary=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});
  try{await fs.rename(temporary,file);}catch(e){await fs.rm(temporary,{force:true});throw e;}
}
export async function ensureProfileAndMigrate({appData,userData,legacyNames=V14_NAMES,log=()=>{}}){
  if(path.resolve(userData)!==path.resolve(appData,DATA_ROOT_NAME))throw Error('PROFILE_ROOT_MISMATCH');
  await fs.mkdir(userData,{recursive:true});
  // The marker is an additional guard for a destructive uninstall. Existing
  // marker with alien contents is a hard error, never overwrite it.
  const marker=path.join(userData,DATA_MARKER);
  const prev=await regularFile(marker,1024);
  if(prev&&prev.toString('utf8')!=='AI_COMMITMENT_STARMAP_OWNED_PROFILE_V15\n')throw Error('PROFILE_MARKER_MISMATCH');
  if(!prev)await fs.writeFile(marker,'AI_COMMITMENT_STARMAP_OWNED_PROFILE_V15\n',{flag:'wx',mode:0o600});
  const dest=path.join(userData,'local');
  if(await regularFile(path.join(dest,'workspace','workspace.json'),6*1024*1024))return {status:'already-initialized',source:null};
  for(const name of legacyNames){
    if(name===DATA_ROOT_NAME||name.includes('..')||name.includes('/')||name.includes('\\'))continue;
    const old=path.join(appData,name,'v14-local');
    const data=await regularFile(path.join(old,'workspace','workspace.json'),6*1024*1024);
    if(!data)continue;
    const db=new ProjectStore(path.join(dest,'workspace'));
    const parsed=JSON.parse(data.toString('utf8'));
    db._check(parsed); // exact V1.4 schema and evidence provenance validation
    const keys=await regularFile(path.join(old,'ai-profiles.json'),50_000);
    inspectEncryptedProfiles(keys);
    // Stage the complete set first, including ciphertext, so a partial copy
    // never becomes the V1.5 source of truth after restart.
    try{await fs.lstat(dest);throw Error('MIGRATION_DESTINATION_ALREADY_PRESENT');}catch(e){if(e.code!=='ENOENT')throw e;}
    const stage=dest+'.stage-'+randomBytes(6).toString('hex');
    const report={source:name,projectCount:parsed.projects.length,sourceUnchanged:true,time:new Date().toISOString(),copiedEncryptedKeyFile:!!keys};
    try{
      await fs.mkdir(path.join(stage,'workspace'),{recursive:true});
      await writeExclusive(path.join(stage,'workspace','workspace.json'),data);
      if(keys)await writeExclusive(path.join(stage,'ai-profiles.json'),keys);
      await writeExclusive(path.join(stage,'migration-v14.json'),Buffer.from(JSON.stringify(report,null,2)));
      await fs.rename(stage,dest);
    }catch(error){await fs.rm(stage,{recursive:true,force:true});throw error;}
    log({event:'v14_migration_succeeded',count:parsed.projects.length});
    return {status:'migrated',...report};
  }
  return {status:'no-source',source:null};
}
