// 3Dのキャラ（img/fighter.dat の中の fighter.fbx）を、ゲームの関節の動きに合わせて骨を曲げて描く。
// three.js で小さな画面に1人ずつ描き、それをゲームの画面（Canvas 2D）に貼る。
// 読み込みに失敗したときは window.Char3D.ready が false のままで、ゲームは従来の棒人間で描く。
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js/+esm';
import { unpackFighter } from './fighter-pack.js';

const U = 0.92;                 // モデルの1単位 = ゲームの何px（肩の高さがゲームとほぼ同じになる）
const BK = 1.35;                // ゲームの関節の単位 → px（game.js の BODY_K）
const YAW = -0.85;              // 斜め前から見る角度（ラジアン）。大きいほど顔が正面を向く
const SIN = Math.sin(YAW), COS = Math.cos(YAW);
const BOX = { l: -140, r: 140, b: -20, t: 240 };   // 描く範囲（モデルの単位）
const RES = 2.2;                // 描く細かさ（ゲームの1pxあたりの画素）
const ANKLE = 10.7, GRIP = 8;   // 足首の高さ、手首から拳の中心まで

const Char3D = { ready: false, draw: null };
window.Char3D = Char3D;

let renderer, scene, camera;
const rigs = [];                // [赤, 青]

function setupRenderer() {
  const w = Math.round((BOX.r - BOX.l) * U * RES), h = Math.round((BOX.t - BOX.b) * U * RES);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x6a5040, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(-3, 4, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe0c0, 0.6); rim.position.set(2, 2, -3); scene.add(rim);
  // 横（-X）から見る。画面の右 = +Z、上 = +Y
  camera = new THREE.OrthographicCamera(BOX.l, BOX.r, BOX.t, BOX.b, 1, 2000);
  camera.position.set(-800, 0, 0); camera.lookAt(0, 0, 0);
}

// 骨の親（Unreal の人型の骨組みと同じ名前）
function PARENT(n) {
  const m = n.match(/^(thumb|index|middle|ring)_0(\d)_([lr])$/);
  if (m) return m[2] === '1' ? `hand_${m[3]}` : `${m[1]}_0${+m[2] - 1}_${m[3]}`;
  const s = n.slice(-1);
  return {
    pelvis: null, belt_root: 'pelvis', spine_01: 'pelvis', spine_02: 'spine_01', spine_03: 'spine_02', neck_01: 'spine_03', head: 'neck_01', hair_root: 'head',
    [`thigh_${s}`]: 'pelvis', [`calf_${s}`]: `thigh_${s}`, [`foot_${s}`]: `calf_${s}`, [`ball_${s}`]: `foot_${s}`,
    [`clavicle_${s}`]: 'spine_03', [`upperarm_${s}`]: `clavicle_${s}`, [`lowerarm_${s}`]: `upperarm_${s}`, [`hand_${s}`]: `lowerarm_${s}`,
  }[n] ?? null;
}
// FBXには部品ごとに同じ骨組みが（入れ子で）入っているので、骨組みを1つ作り直して全部品をつなぎ直す
// （骨はどれも休み姿勢で回転なし。位置だけ写せばよい）
function buildRig(obj, texture) {
  const meshes = [];
  obj.traverse((n) => { if (n.isSkinnedMesh) meshes.push(n); });
  obj.updateMatrixWorld(true);
  // 骨の休み姿勢の位置は、部品の「バインド時の骨の行列」から取る
  const sk = meshes[0].skeleton, wp = {}, master = {};
  sk.bones.forEach((b, i) => { wp[b.name] = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert()); });
  for (const name of Object.keys(wp)) { const n = new THREE.Bone(); n.name = name; master[name] = n; }
  for (const name of Object.keys(wp)) {
    const par = PARENT(name), n = master[name];
    n.position.copy(wp[name]).sub(par ? wp[par] : new THREE.Vector3());
    (par ? master[par] : obj).add(n);
  }
  for (const m of meshes) {
    const bones = m.skeleton.bones.map((b) => master[b.name]);
    m.bind(new THREE.Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
  }
  for (const c of [...obj.children]) if (c.isBone && c !== master.pelvis) obj.remove(c);   // 古い骨組みを外す
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  for (const m of meshes) { m.material = mat; m.frustumCulled = false; }
  // 顔と手は、表情・手の形ごとの別モデルを首と手首の骨に付けて入れ替える（元の頭と手は隠す）
  for (const m of meshes) if (/head|hand/.test(m.name)) m.visible = false;
  const faces = {}, hands = {};
  let grip = null;
  for (const [key, geo] of Object.entries(PARTS)) {
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false;
    const [kind, a, b] = key.split('_');
    if (kind === 'head') { master.head.add(mesh); faces[a] = mesh; }
    else if (a === 'r') { master.hand_r.add(mesh); hands[b] = mesh; }
    else { master.hand_l.add(mesh); }                 // 漢字を握る手（いつも拳）
    if (key === 'hand_l_fist') { mesh.visible = true; grip = mesh; }
  }
  const rest = {};
  for (const [k, b] of Object.entries(master)) rest[k] = { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() };
  const root = new THREE.Group(); root.add(obj); root.rotation.y = YAW;
  return { root, obj, B: master, rest, mat, faces, hands, grip, face: null, hand: null, look: 0 };
}
// 顔・手のモデル（img/fighter_parts.json：FBX を base64 にしてまとめたもの）。キーは head_表情 / hand_r_形 / hand_l_fist
const PARTS = {};

// ---------- 骨を曲げる ----------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const wpos = (b, out = new THREE.Vector3()) => b.getWorldPosition(out);
// 骨の向き（子の骨の方向）を、ワールドの方向 dir に向ける
function aim(bone, child, dir) {
  const rest = _v2.copy(child.position).normalize();
  const want = _q.setFromUnitVectors(rest, _v.copy(dir).normalize());        // 骨の休み姿勢はワールドと同じ向き
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(want));
  bone.updateMatrixWorld(true);
}
// 2本の骨（上腕・前腕、もも・すね）を、先端が target に届くように曲げる。pole は曲がる側
function twoBone(r, a, b, c, target, pole, maxScale) {
  const A = wpos(a), d = new THREE.Vector3().subVectors(target, A);
  let L1 = b.position.length(), L2 = c.position.length();
  let dist = d.length();
  if (maxScale > 1) {                                   // 届かない腕は少し伸ばす（太さもいっしょに）
    const s = Math.min(maxScale, Math.max(1, dist / ((L1 + L2) * 0.97)));
    a.scale.setScalar(s); L1 *= s; L2 *= s;
  }
  dist = Math.min(Math.max(dist, Math.abs(L1 - L2) + 0.5), L1 + L2 - 0.3);
  const n = d.normalize();
  const p = pole.clone().sub(n.clone().multiplyScalar(pole.dot(n))).normalize();
  const ca = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const elbow = A.clone().add(n.clone().multiplyScalar(L1 * ca)).add(p.multiplyScalar(L1 * sa));
  aim(a, b, elbow.clone().sub(A));
  const end = A.clone().add(n.multiplyScalar(dist));
  aim(b, c, end.sub(wpos(b)));
}
// 手首をひねって、手のひら（休み姿勢で palm の向き）を want の向きに近づける（前腕の軸まわりに回すだけ）
function palmTo(hand, lower, palm, want) {
  const axis = wpos(hand).sub(wpos(lower)).normalize();
  const hq = hand.getWorldQuaternion(new THREE.Quaternion());
  const cur = palm.clone().applyQuaternion(hq);
  const flat = (v) => v.sub(axis.clone().multiplyScalar(v.dot(axis))).normalize();
  const a = flat(cur), b = flat(want.clone());
  const ang = Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(axis), a.dot(b));
  const wq = new THREE.Quaternion().setFromAxisAngle(axis, ang).multiply(hq);
  hand.parent.getWorldQuaternion(_q2);
  hand.quaternion.copy(_q2.invert().multiply(wq));
  hand.updateMatrixWorld(true);
}
// カメラの方向（モデルの向きで。斜めに見ているぶんを戻す）
const TO_CAM = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -YAW), FROM_CAM = TO_CAM.clone().negate();
const PALM_L = new THREE.Vector3(0, -1, 0), PALM_R = new THREE.Vector3(0, -1, 0);   // 休み姿勢（T字）の手のひらの向き

// ゲームの画面上の位置（足元から、前向きの px）→ モデルの位置（斜めに見ているぶんを戻す）
function toModel(u, v, x) { return new THREE.Vector3(x, v / U, (u / U + x * SIN) / COS); }

const POLE_KNEE = new THREE.Vector3(0, 0, 1), POLE_ELBOW = new THREE.Vector3(0, -1, -0.6);
const POLE_ELBOW_FAR = new THREE.Vector3(1, -0.7, -0.3);     // 漢字を持つ奥の腕のひじは外側・下へ

function pose(rig, o) {
  const { B, rest } = rig;
  for (const [k, r] of Object.entries(rest)) { const b = B[k]; b.position.copy(r.p); b.quaternion.copy(r.q); b.scale.copy(r.s); }
  rig.root.rotation.y = 0;                                                      // 骨はモデルの向きのまま曲げる
  const J = o.J;
  // 腰の高さ：ゲームの腰の高さに合わせる。足を広げているときは届くまで下げる
  const L = B.calf_r.position.length() + B.foot_r.position.length();
  const thighDrop = -rest.thigh_r.p.y;                                          // 骨盤から股関節まで
  let py = rest.pelvis.p.y * (J.hip[1] / -38);
  // 斜め前から見ると手前（右）の腰は画面の後ろ側に来るので、右足を後ろ足、左足を前足にする（足が交差しない）
  // fbX：蹴りのときは手前の足先を体の前へ回す（斜め前から見ると、まっすぐ前に蹴った足は手前に重なって短く見えるので）
  const feet = [[J.ff, 9], [J.fb, J.fbX != null ? J.fbX : -9]].map(([f, x]) => toModel(f[0] * BK, -f[1] * BK, x).add(new THREE.Vector3(0, ANKLE, 0)));
  // 足の開きは脚の長さの7割まで（斜めから見ると開きが大きく計算され、腰が床まで落ちて座って見えるので）
  const hipZ = J.hip[0] * BK / U, spread = L * 0.7;
  // 蹴りの最中の蹴り足（J.kick 番目。1＝手前の脚）は、脚をのばして前へ高く上げるので制限しない
  feet.forEach((f, i) => { if (!(J.kick && i === J.kick)) f.z = hipZ + Math.max(-spread, Math.min(spread, f.z - hipZ)); });
  for (const f of feet) {
    const dz = f.z - hipZ, need = f.y + Math.sqrt(Math.max(0, (L * 0.985) ** 2 - dz * dz)) + thighDrop;
    if (need < py) py = need;
  }
  B.pelvis.position.y = py;
  B.pelvis.position.z = rest.pelvis.p.z + J.hip[0] * BK / U;
  B.spine_01.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), o.bend || 0));
  rig.root.updateMatrixWorld(true);
  // 足（左足が前の足、手前の右足が後ろの足）
  twoBone(null, B.thigh_l, B.calf_l, B.foot_l, feet[0], POLE_KNEE, 1);
  twoBone(null, B.thigh_r, B.calf_r, B.foot_r, feet[1], POLE_KNEE, 1);
  for (const s of ['r', 'l']) { const f = B['foot_' + s]; f.parent.getWorldQuaternion(_q2); f.quaternion.copy(_q2.invert()); f.updateMatrixWorld(true); }
  // 奥の腕（左手）：漢字を持つ手の位置へ。手前の腕で持つと顔が隠れるので、奥の腕で持つ
  const g = toModel(o.grip[0], o.grip[1], 22);
  const sh = wpos(B.upperarm_l), dir = g.clone().sub(sh).normalize();
  twoBone(null, B.upperarm_l, B.lowerarm_l, B.hand_l, g.clone().sub(dir.multiplyScalar(GRIP)), POLE_ELBOW_FAR, 1.35);
  // 手前の腕（右手）：胸の前で構える
  const h = toModel(J.hb[0] * BK, -J.hb[1] * BK, -12);
  // 画面で顔に重なるときは、あごの下まで下げる（顔を隠さない）。遠くへ突き出した手や頭の上の手はそのまま
  const hd = wpos(B.head), scr = (p) => p.z * COS - p.x * SIN;              // 斜めに見たときの画面の横位置
  if (Math.abs(scr(h) - scr(hd)) < 45 && h.y > hd.y - 6 && h.y < hd.y + 45) h.y = hd.y - 6;
  twoBone(null, B.upperarm_r, B.lowerarm_r, B.hand_r, h, POLE_ELBOW, 1);
  // 字を持つ奥の手は手のひらをこちらへ（握った指が見える）、手前の手は甲をこちらへ向ける
  palmTo(B.hand_l, B.lowerarm_l, PALM_L, TO_CAM);
  palmTo(B.hand_r, B.lowerarm_r, PALM_R, FROM_CAM);
  // ダメージを受けたときと倒れたとき（o.look）は、顔をこちら（カメラ）へ向ける。終わると前へ向き直す（数コマかけて回す）
  rig.look += ((o.look ? 1 : 0) - rig.look) * 0.25;
  if (rig.look > 0.01) {
    const turn = Math.atan2(TO_CAM.x, TO_CAM.z) * rig.look;              // 前（+Z）からカメラの方向までの角度
    const wq = _q.setFromAxisAngle(_v.set(0, 1, 0), turn).multiply(B.head.getWorldQuaternion(new THREE.Quaternion()));
    B.head.parent.getWorldQuaternion(_q2);
    B.head.quaternion.copy(_q2.invert().multiply(wq));
    B.head.updateMatrixWorld(true);
  }
  rig.root.rotation.y = YAW;
  rig.root.updateMatrixWorld(true);
}

const WHITE = new THREE.Color(1, 1, 1);
function choose(map, cur, want, fallback) {
  const k = map[want] ? want : fallback;
  if (cur !== k) { if (map[cur]) map[cur].visible = false; map[k].visible = true; }
  return k;
}
const DRAW = [BOX.l * U, -BOX.t * U, (BOX.r - BOX.l) * U, (BOX.t - BOX.b) * U];
// ctx の原点 = 足元、右向き、1単位 = 1px の状態で呼ぶ。
// o = { J: 関節, grip: 拳を持っていきたい位置 [前, 上]px, tint, face: 表情, hand: 手前の手の形, look: 顔をこちらへ向けるか }
// 戻り値：描けたら拳の位置 [前, 上]px、描けなかったら null
Char3D.draw = function (ctx, side, o) {
  const rig = rigs[side];
  if (!rig) return null;
  rig.face = choose(rig.faces, rig.face, o.face, 'neutral');
  rig.hand = choose(rig.hands, rig.hand, o.hand, 'karatechop');
  pose(rig, o);
  // 状態の色（凍結・毒・ヒットの白など）：色をかけて、少し光らせる
  if (o.tint) { const c = new THREE.Color(o.tint[0]); rig.mat.color.copy(WHITE).lerp(c, o.tint[1]); rig.mat.emissive.copy(c).multiplyScalar(o.tint[1] * 0.55); }
  else { rig.mat.color.copy(WHITE); rig.mat.emissive.setRGB(0, 0, 0); }
  scene.add(rig.root);
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, ...DRAW);
  scene.remove(rig.root);
  // 拳の中心（手首から前腕の向きに少し先）
  const B = rig.B, w = wpos(B.hand_l), f = w.clone().sub(wpos(B.lowerarm_l)).normalize().multiplyScalar(GRIP * B.upperarm_l.scale.x).add(w);
  return [f.z * U, f.y * U];
};

async function init() {
  setupRenderer();
  const base = new URL('img/', document.baseURI).href;
  // モデル・顔と手のパーツ・赤と青の色は、暗号化した fighter.dat 1つにまとめてある（素材のライセンスのため。fighter-pack.js）
  const files = unpackFighter(await new THREE.FileLoader().setResponseType('arraybuffer').loadAsync(base + 'fighter.dat'));
  const buf = files['fighter.fbx'].buffer;
  const png = (n) => URL.createObjectURL(new Blob([files[n]], { type: 'image/png' }));
  const redUrl = png('fighter_red.png'), blueUrl = png('fighter_blue.png');
  const tl = new THREE.TextureLoader();
  const texs = await Promise.all([redUrl, blueUrl].map((u) => tl.loadAsync(u)));
  const parts = JSON.parse(new TextDecoder().decode(files['fighter_parts.json']));
  for (const [k, b64] of Object.entries(parts)) {
    const o = new FBXLoader().parse(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, base);
    o.traverse((n) => { if (n.isMesh && !PARTS[k]) PARTS[k] = n.geometry; });
  }
  for (let i = 0; i < 2; i++) {
    texs[i].colorSpace = THREE.SRGBColorSpace;
    const mgr = new THREE.LoadingManager(); mgr.setURLModifier((u) => (/\.tga$/i.test(u) ? redUrl : u));
    const obj = new FBXLoader(mgr).parse(buf, base);
    rigs[i] = buildRig(obj, texs[i]);
  }
  Char3D.ready = true;
  if (/[?&]debug/.test(location.search)) Object.assign(Char3D, { rigs, THREE, renderer });
}
init().catch((e) => { console.warn('3Dキャラを読み込めなかったので、棒人間で描きます', e); });
