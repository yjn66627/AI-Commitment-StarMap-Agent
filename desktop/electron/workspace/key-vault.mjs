// The JSON file contains DPAPI-protected encrypted strings only, never plaintext API keys.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {validateModelConfig} from './model-providers.mjs';
export class KeyVault{
  constructor(directory,safeStorage){this.file=path.join(directory,'ai-profiles.json');this.safeStorage=safeStorage;this.queue=Promise.resolve();}
  async _read(){try{const raw=await fs.readFile(this.file,'utf8');if(raw.length>50000)throw Error('PROFILE_FILE_TOO_LARGE');const data=JSON.parse(raw);if(data.version!==1||!data.profiles||typeof data.profiles!=='object')throw Error('PROFILE_INVALID');return data;}catch(e){if(e.code==='ENOENT')return {version:1,selected:'deepseek',profiles:{}};throw e;}}
  async _write(data){await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomBytes(6).toString('hex')+'.tmp';await fs.writeFile(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});try{await fs.rename(tmp,this.file);}catch(e){await fs.rm(tmp,{force:true});throw e;}}
  async _encryptedAvailable(){const s=this.safeStorage;if(typeof s.isAsyncEncryptionAvailable==='function')return !!await s.isAsyncEncryptionAvailable();if(typeof s.isEncryptionAvailable==='function')return !!s.isEncryptionAvailable();return false;}
  async _encrypt(key){if(!await this._encryptedAvailable())throw Error('SECURE_STORAGE_UNAVAILABLE');const s=this.safeStorage;const result=typeof s.encryptStringAsync==='function'?await s.encryptStringAsync(key):s.encryptString(key);return Buffer.from(result).toString('base64');}
  async _decrypt(encoded){if(!await this._encryptedAvailable())throw Error('SECURE_STORAGE_UNAVAILABLE');const data=Buffer.from(encoded,'base64');const s=this.safeStorage;const decrypted=typeof s.decryptStringAsync==='function'?await s.decryptStringAsync(data):s.decryptString(data);
    if(typeof decrypted==='string')return decrypted;
    if(decrypted&&typeof decrypted.result==='string')return decrypted.result;
    throw Error('SECURE_STORAGE_DECRYPT_FAILED');}
  async publicSettings(){const d=await this._read();return {selected:d.selected,profiles:Object.fromEntries(Object.entries(d.profiles).map(([id,p])=>[id,{model:p.model,endpoint:p.endpoint,hasKey:!!p.secret}]))};}
  async save(input){const config=validateModelConfig(input);if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>1024))throw Error('API_KEY_INVALID');let secret;if(typeof input.apiKey==='string'&&input.apiKey.trim())secret=await this._encrypt(input.apiKey.trim());const task=this.queue.then(async()=>{const d=await this._read();const prev=d.profiles[config.provider]||{};d.profiles[config.provider]={...config,secret:secret??prev.secret??null};d.selected=config.provider;await this._write(d);return this.publicSettings();});this.queue=task.catch(()=>{});return task;}
  async deleteKey(provider){const task=this.queue.then(async()=>{const d=await this._read();if(d.profiles[provider])d.profiles[provider].secret=null;await this._write(d);return this.publicSettings();});this.queue=task.catch(()=>{});return task;}
  async active(){const d=await this._read();const p=d.profiles[d.selected];if(!p)throw Error('MODEL_NOT_CONFIGURED');const config=validateModelConfig(p);const key=p.secret?await this._decrypt(p.secret):'';if(config.provider!=='ollama'&&!key)throw Error('API_KEY_REQUIRED');return {config,key};}
}
