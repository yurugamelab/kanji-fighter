// 3Dキャラの素材（モデル・顔と手のパーツ・赤と青の色）を、1つの暗号化ファイル img/fighter.dat にまとめる／元に戻す。
// 素材（CGTrader の空手家モデル）のライセンスで、遊ぶ人がモデルを取り出せないようにすることが求められているため。
// 作るとき： node tools/pack_fighter.mjs （img/ の元ファイルから img/fighter.dat を作る）
// 使うとき： char3d.js が unpackFighter() で元に戻してから読み込む。
// 暗号は ChaCha20（どの環境でも動くように、自前で書いている）。

const K = '89b9677a62086a2c' + 'a8793904811385cf' + 'e34f8bef3fc0bca3' + 'e15ff0cb8303485e';
const MAGIC = 'KFE1';

function hex(s) { const a = new Uint8Array(s.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16); return a; }

// ChaCha20（RFC 8439）。同じ鍵・nonce で2回かけると元に戻る
function chacha20(key, nonce, data) {
  const k = new Uint32Array(8), n = new Uint32Array(3);
  const dk = new DataView(key.buffer, key.byteOffset, 32), dn = new DataView(nonce.buffer, nonce.byteOffset, 12);
  for (let i = 0; i < 8; i++) k[i] = dk.getUint32(i * 4, true);
  for (let i = 0; i < 3; i++) n[i] = dn.getUint32(i * 4, true);
  const out = new Uint8Array(data.length), s = new Uint32Array(16), x = new Uint32Array(16);
  const ks = new Uint8Array(64), kv = new DataView(ks.buffer);
  const rot = (v, c) => (v << c) | (v >>> (32 - c));
  const qr = (a, b, c, d) => {
    x[a] += x[b]; x[d] = rot(x[d] ^ x[a], 16); x[c] += x[d]; x[b] = rot(x[b] ^ x[c], 12);
    x[a] += x[b]; x[d] = rot(x[d] ^ x[a], 8); x[c] += x[d]; x[b] = rot(x[b] ^ x[c], 7);
  };
  for (let pos = 0, ctr = 1; pos < data.length; pos += 64, ctr++) {
    s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
    s.set(k, 4); s[12] = ctr; s[13] = n[0]; s[14] = n[1]; s[15] = n[2];
    x.set(s);
    for (let r = 0; r < 10; r++) {
      qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
      qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
    }
    for (let i = 0; i < 16; i++) kv.setUint32(i * 4, (x[i] + s[i]) >>> 0, true);
    const end = Math.min(64, data.length - pos);
    for (let i = 0; i < end; i++) out[pos + i] = data[pos + i] ^ ks[i];
  }
  return out;
}

// files: { 名前: Uint8Array } → 暗号化したファイルの中身（Uint8Array）
export function packFighter(files, nonce) {
  const enc = new TextEncoder(), parts = [];
  let size = 0;
  for (const [name, data] of Object.entries(files)) {
    const nm = enc.encode(name), head = new Uint8Array(1 + nm.length + 4);
    head[0] = nm.length; head.set(nm, 1);
    new DataView(head.buffer).setUint32(1 + nm.length, data.length, true);
    parts.push(head, data); size += head.length + data.length;
  }
  const plain = new Uint8Array(size);
  let p = 0; for (const a of parts) { plain.set(a, p); p += a.length; }
  const out = new Uint8Array(4 + 12 + size);
  out.set(enc.encode(MAGIC), 0); out.set(nonce, 4); out.set(chacha20(hex(K), nonce, plain), 16);
  return out;
}

// 暗号化したファイルの中身（ArrayBuffer）→ { 名前: Uint8Array }
export function unpackFighter(buf) {
  const all = new Uint8Array(buf);
  if (new TextDecoder().decode(all.subarray(0, 4)) !== MAGIC) throw new Error('fighter.dat の形がちがう');
  const plain = chacha20(hex(K), all.slice(4, 16), all.subarray(16));
  const dv = new DataView(plain.buffer), dec = new TextDecoder(), files = {};
  for (let p = 0; p < plain.length;) {
    const n = plain[p], name = dec.decode(plain.subarray(p + 1, p + 1 + n));
    const len = dv.getUint32(p + 1 + n, true), start = p + 1 + n + 4;
    files[name] = plain.slice(start, start + len);
    p = start + len;
  }
  return files;
}
