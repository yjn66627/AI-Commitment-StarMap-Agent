import { randomBytes, scryptSync } from 'node:crypto';
import { stdin } from 'node:process';
let password = '';
for await (const chunk of stdin.setEncoding('utf8')) {
  password += chunk;
  if (password.length > 200) throw Error('INVALID_PASSWORD_LENGTH');
}
password = password.replace(/\r?\n$/, '');
if (password.length < 16 || password.length > 128) throw Error('INVALID_PASSWORD_LENGTH');
const salt = randomBytes(16);
process.stdout.write(salt.toString('hex') + ':' + scryptSync(password, salt, 32).toString('hex'));
