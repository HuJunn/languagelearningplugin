import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, '.output');
const KEY_PATH = path.join(ROOT, '.crx-key.pem');

function encodeVarint(num) {
  const bytes = [];
  let n = num >>> 0;
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

function pbFieldBytes(fieldNum, buf) {
  const tag = (fieldNum << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(buf.length), buf]);
}

function getOrCreateKey() {
  if (fs.existsSync(KEY_PATH)) {
    return fs.readFileSync(KEY_PATH, 'utf8');
  }
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.writeFileSync(KEY_PATH, privateKey, 'utf8');
  return privateKey;
}

function toExtensionId(crxIdBytes) {
  // Base16 using a..p
  let id = '';
  for (const b of crxIdBytes) {
    id += String.fromCharCode(97 + ((b >> 4) & 0xf));
    id += String.fromCharCode(97 + (b & 0xf));
  }
  return id;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const expectedZipName = `${pkg.name}-${pkg.version}-edge.zip`;
const expectedZipPath = path.join(OUT_DIR, expectedZipName);

let srcZip = '';
if (fs.existsSync(expectedZipPath)) {
  srcZip = expectedZipPath;
} else {
  const zipFiles = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('-edge.zip'))
    .map((f) => ({ name: f, full: path.join(OUT_DIR, f), mtime: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!zipFiles.length) {
    throw new Error('No *-edge.zip found in .output/. Run `wxt zip -b edge` first.');
  }
  srcZip = zipFiles[0].full;
}
const zipBuf = fs.readFileSync(srcZip);
console.log(`Using source zip: ${path.basename(srcZip)} (${zipBuf.length} bytes)`);

const privPem = getOrCreateKey();
const pubDer = crypto.createPublicKey(privPem).export({ type: 'spki', format: 'der' });

// crx_id is the first 16 bytes of SHA-256(pubDer)
const crxId = crypto.createHash('sha256').update(pubDer).digest().subarray(0, 16);
const extId = toExtensionId(crxId);

// SignedData protobuf: field 1 (bytes) = crx_id
const signedHeaderData = pbFieldBytes(1, crxId);

// Signature over: "CRX3 SignedData\x00" + uint32LE(signedHeaderData.length) + signedHeaderData + zipBuf
const prefix = Buffer.from('CRX3 SignedData\x00', 'utf8');
const lenBuf = Buffer.alloc(4);
lenBuf.writeUInt32LE(signedHeaderData.length, 0);

const signer = crypto.createSign('RSA-SHA256');
signer.update(prefix);
signer.update(lenBuf);
signer.update(signedHeaderData);
signer.update(zipBuf);
const signature = signer.sign(privPem);

// AsymmetricKeyProof protobuf: field 1 = public_key, field 2 = signature
const rsaProof = Buffer.concat([pbFieldBytes(1, pubDer), pbFieldBytes(2, signature)]);

// CrxFileHeader protobuf: field 2 = sha256_with_rsa, field 10000 = signed_header_data
const crxHeader = Buffer.concat([pbFieldBytes(2, rsaProof), pbFieldBytes(10000, signedHeaderData)]);

const magic = Buffer.from('Cr24', 'utf8');
const version = Buffer.alloc(4);
version.writeUInt32LE(3, 0);
const headerLen = Buffer.alloc(4);
headerLen.writeUInt32LE(crxHeader.length, 0);

const crxBuf = Buffer.concat([magic, version, headerLen, crxHeader, zipBuf]);
const crxOut = path.join(OUT_DIR, 'yt-shadowing.crx');
const zipCopy = path.join(OUT_DIR, 'yt-shadowing.zip');
fs.writeFileSync(crxOut, crxBuf);
if (srcZip !== zipCopy) fs.copyFileSync(srcZip, zipCopy);

// Generate updates.xml for GitHub auto-update
const codebaseUrl =
  'https://raw.githubusercontent.com/HuJunn/languagelearningplugin/main/releases/android/yt-shadowing-android.crx';
const updatesXml = [
  "<?xml version='1.0' encoding='UTF-8'?>",
  "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>",
  `  <app appid='${extId}'>`,
  `    <updatecheck codebase='${codebaseUrl}' version='${pkg.version}' />`,
  '  </app>',
  '</gupdate>',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'updates.xml'), updatesXml, 'utf8');

console.log(`Packed CRX3: ${crxOut} (${(crxBuf.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Extension ID: ${extId}`);
