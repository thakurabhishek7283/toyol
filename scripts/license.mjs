// License keys. toyol works on a PC once it has a license key made for that
// PC: until then it shows the PC's code (XXXX-XXXX-XXXX-XXXX, from Windows'
// MachineGuid: src-tauri/src/license.rs). The customer sends you the code,
// this signs a key for it, and they paste the key into toyol. Nothing goes
// online: the key carries its own signature, which toyol checks.
//
//   npm run license -- sign <PC code> "Customer name" [--expires 2027-12-31]
//   npm run license -- show <key>    what a key says, and whether it's genuine
//   npm run license -- key           make the signing key if there isn't one,
//                                    and print its public half for license.rs
//
// The signing key is ~/.tauri/toyol-license.pem, or the file TOYOL_LICENSE_KEY
// names. Keep a copy somewhere safe and never share it: anyone with it can make
// keys, and with a new one (and its public half in license.rs) the keys already
// sent stop working. Every key signed is listed in toyol-license-keys.csv next
// to it, to look up a customer later.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const KEY_FILE = process.env.TOYOL_LICENSE_KEY ?? join(homedir(), '.tauri', 'toyol-license.pem');
const LOG_FILE = join(dirname(KEY_FILE), 'toyol-license-keys.csv');
// license.rs accepts only keys for this product
const PRODUCT = 'toyol';
// Crockford's base32, which license.rs writes the PC code in: no I, L, O or U,
// so it reads aloud and types without mix-ups
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function privateKey() {
  if (!existsSync(KEY_FILE)) fail(`No signing key at ${KEY_FILE}. Make one with: npm run license -- key`);
  const key = createPrivateKey(readFileSync(KEY_FILE));
  if (key.asymmetricKeyType !== 'ed25519') fail(`${KEY_FILE} isn't an Ed25519 key.`);
  return key;
}

// The public half as license.rs's PUBLIC_KEY wants it: the raw 32 bytes, base64url
const publicKey = (key) => createPublicKey(key).export({ format: 'jwk' }).x;

/** The PC code as license.rs writes it, from what the customer sent; null if it's mistyped */
function pcCode(text) {
  const chars = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (chars.length !== 16 || [...chars].some((c) => !ALPHABET.includes(c))) return null;
  // The last character checks the other 15
  const check = ALPHABET[createHash('sha256').update(chars.slice(0, 15)).digest()[0] % 32];
  return check === chars[15] ? chars.match(/.{4}/g).join('-') : null;
}

const csv = (value) => `"${String(value).replace(/"/g, '""')}"`;

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
};
const expiresOn = option('--expires');
const [command, ...rest] = args;

if (command === 'sign') {
  const [codeText, name] = rest;
  if (!codeText || !name?.trim()) fail('Usage: npm run license -- sign <PC code> "Customer name" [--expires YYYY-MM-DD]');
  const code = pcCode(codeText);
  if (!code) fail(`${codeText} isn't a PC code toyol shows: check it with the customer (16 characters, like ABCD-EFGH-JKMN-PQR5).`);

  // Works through the whole of that day, UTC
  let expires;
  if (expiresOn !== undefined) {
    const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresOn) ?? fail('--expires takes a date like 2027-12-31');
    expires = Date.UTC(Number(y), Number(m) - 1, Number(d) + 1) / 1000;
    if (expires * 1000 <= Date.now()) fail(`${expiresOn} has already passed.`);
  }

  const grant = { product: PRODUCT, machine: code, name: name.trim(), ...(expires && { expires }) };
  const payload = Buffer.from(JSON.stringify(grant));
  const key = `${payload.toString('base64url')}.${sign(null, payload, privateKey()).toString('base64url')}`;

  if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, 'issued,pc_code,customer,expires,key\n');
  appendFileSync(LOG_FILE, [new Date().toISOString(), code, csv(grant.name), expiresOn ?? '', key].join(',') + '\n');

  console.log(`License key for ${grant.name}, PC ${code}${expiresOn ? `, until ${expiresOn}` : ''}:\n\n${key}\n`);
  console.log('They paste it into toyol (it shows where on first start). It works on that PC only.');
} else if (command === 'show') {
  const [payload, signature] = rest.join('').replace(/\s/g, '').split('.');
  if (!payload || !signature) fail('Usage: npm run license -- show <key>');
  const bytes = Buffer.from(payload, 'base64url');
  const genuine = verify(null, bytes, createPublicKey(privateKey()), Buffer.from(signature, 'base64url'));
  let grant;
  try {
    grant = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail("That isn't a toyol license key.");
  }
  console.log(grant);
  if (grant.expires) console.log(`Expires: ${new Date(grant.expires * 1000).toISOString()}`);
  console.log(genuine ? 'Signed with your key: genuine.' : 'NOT signed with your key: toyol rejects it.');
} else if (command === 'key') {
  if (!existsSync(KEY_FILE)) {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    const { privateKey: made } = generateKeyPairSync('ed25519');
    writeFileSync(KEY_FILE, made.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log(`Made the signing key: ${KEY_FILE}. Back it up somewhere safe.`);
  }
  console.log(`Public half, for PUBLIC_KEY in src-tauri/src/license.rs:\n\n${publicKey(privateKey())}`);
} else {
  fail('Usage: npm run license -- sign <PC code> "Customer name" [--expires YYYY-MM-DD] | show <key> | key');
}
