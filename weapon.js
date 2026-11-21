// 漢字1文字から武器の性能を決める。
// 1) 特別な漢字は専用の効果  2) どの字にも画数ルール（多いほど 大きい・重い・遅い・強い）
// 画数は kanji-data.js（KANJIDIC2）から引き、無い字は描画したときの黒さから推定する。
(function () {
  const FONT_FAMILY = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif';
  const L = (ja, en) => (window.I18N ? I18N.L(ja, en) : ja);   // 日本語／英語

  // ---- 画数テーブル ----
  const strokeMap = new Map();
  const raw = window.KANJI_STROKES_RAW || {};
  for (const n in raw) for (const ch of raw[n]) strokeMap.set(ch, Number(n));
  // KANJIDIC2 に無い「画数が多すぎて有名な字」（推定だと低く出てしまうので直接持つ）
  const EXTRA = { '齉': 36, '靐': 39, '龘': 48, '䨻': 52, '𰻞': 58, '𪚥': 64, '𱁬': 84 };
  for (const ch in EXTRA) strokeMap.set(ch, EXTRA[ch]);

  // ---- 黒さから画数を推定（表に無い字用）----
  const CALIB = [['一',1],['十',2],['口',3],['木',4],['田',5],['糸',6],['車',7],['金',8],
    ['前',9],['書',10],['黒',11],['森',12],['電',13],['説',14],['線',15],['頭',16],
    ['観',18],['議',20],['鬱',29]];
  let fit = null;
  const inkCache = new Map();
  function ink(ch) {
    if (inkCache.has(ch)) return inkCache.get(ch);
    const S = 72, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.font = `64px ${FONT_FAMILY}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, S / 2, S / 2);
    const d = g.getImageData(0, 0, S, S).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    const r = n / (S * S);
    inkCache.set(ch, r);
    return r;
  }
  // ---- 字の形（縦横の比率）で得意技を決める ----
  const shapeCache = new Map();
  function aspect(ch) {
    if (shapeCache.has(ch)) return shapeCache.get(ch);
    const S = 96, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.font = `80px ${FONT_FAMILY}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, S / 2, S / 2);
    const d = g.getImageData(0, 0, S, S).data;
    let x0 = S, x1 = -1, y0 = S, y1 = -1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (d[(y * S + x) * 4 + 3] > 100) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const r = x1 < 0 ? 1 : (x1 - x0 + 1) / (y1 - y0 + 1);
    shapeCache.set(ch, r);
    return r;
  }
  // ---- 字の形の特徴（どの字にも効く）----
  // かぎ・とがり・平らな面・真ん中の縦棒は KanjiVG の筆画から作った kanji-shapes.js、穴は描いた字から判定する
  const shapeMap = new Map();
  for (const line of (window.KANJI_SHAPES_RAW || '').split('\n')) { const c = [...line][0]; if (c) shapeMap.set(c, line.slice(c.length)); }
  const holeCache = new Map();
  // 囲み（穴）：字の中に、外とつながっていない白い部分がある（口・日・田・国）。小さなすき間は数えない
  function hasHole(ch) {
    if (holeCache.has(ch)) return holeCache.get(ch);
    const S = 96, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.font = `900 80px ${FONT_FAMILY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, S / 2, S / 2 + 4);
    const d = g.getImageData(0, 0, S, S).data, inkAt = (x, y) => d[(y * S + x) * 4 + 3] > 110;
    let x0 = S, x1 = -1, y0 = S, y1 = -1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (inkAt(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let found = false;
    if (x1 >= 0) {
      const seen = new Uint8Array(S * S), area = (x1 - x0 + 1) * (y1 - y0 + 1);
      for (let y = y0; y <= y1 && !found; y++) for (let x = x0; x <= x1 && !found; x++) {
        if (inkAt(x, y) || seen[y * S + x]) continue;
        let n = 0, edge = false; const st = [x, y]; seen[y * S + x] = 1;
        while (st.length) {
          const py = st.pop(), px = st.pop(); n++;
          if (px === x0 || px === x1 || py === y0 || py === y1) edge = true;
          for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
            if (qx < x0 || qx > x1 || qy < y0 || qy > y1 || seen[qy * S + qx] || inkAt(qx, qy)) continue;
            seen[qy * S + qx] = 1; st.push(qx, qy);
          }
        }
        if (!edge && n > area * 0.04) found = true;
      }
    }
    holeCache.set(ch, found);
    return found;
  }
  // light=軽い（4画以下） point=先がとがっている hook=かぎ（'l'左・'r'右・'b'下） flat=平らな面（'t'上・'b'下） pole=真ん中の縦棒 hole=囲み
  function traitsOf(ch, strokes) {
    const t = { light: strokes <= 4, hole: hasHole(ch) };
    for (const p of (shapeMap.get(ch) || '').split(',')) {
      if (p[0] === 'h') t.hook = p.slice(1) || 'b';
      else if (p === 'p') t.point = true;
      else if (p[0] === 'f') t.flat = p.slice(1);
      else if (p === 'v') t.pole = true;
    }
    return t;
  }
  const SHAPES = {
    wide:   { name: '横長', move: 'slash',  text: L("横長（横薙ぎが得意）", "Wide (good at sweeps)") },
    tall:   { name: '縦長', move: 'thrust', text: L("縦長（突きが得意）", "Tall (good at stabs)") },
    dense:  { name: '詰まった字', move: 'smash', text: L("詰まった字（叩きつけが得意）", "Packed (good at slams)") },
    normal: { name: 'ふつう', move: null, text: L("ふつう（バランス型）", "Normal (balanced)") },
  };
  function shapeOf(ch, strokes) {
    const r = aspect(ch);
    if (r >= 1.12) return 'wide';   // 一・二・三・皿・工・王 など
    if (r <= 0.9) return 'tall';    // 卜・中・目・日・月・自・弓 など
    if (strokes >= 15) return 'dense';
    return 'normal';
  }

  function estimateStrokes(ch) {
    if (!fit) { // 最小二乗で 画数 = a * 黒さ + b
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [c, s] of CALIB) { const x = ink(c); sx += x; sy += s; sxx += x * x; sxy += x * s; }
      const n = CALIB.length;
      const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      fit = { a, b: (sy - a * sx) / n };
    }
    return Math.max(1, Math.min(40, Math.round(fit.a * ink(ch) + fit.b)));
  }

  // ---- 特別な漢字 ----
  // mod: 画数ルールで出した値に掛ける倍率など
  const SPECIALS = {
    '炎': { effect: 'burn',    text: '当てると相手がしばらく燃える' },
    '氷': { effect: 'freeze',  text: '当てると相手が凍って動けない', mod: { power: 0.85 } },
    '雷': { effect: 'stun',    text: '攻撃が速い。ときどき相手がしびれる', mod: { startup: 0.6, recovery: 0.7 } },
    '重': { effect: 'heavy',   text: '当たると相手が吹っ飛ぶ', mod: { knockback: 2.5, power: 1.2, startup: 1.2 } },
    '盾': { effect: 'shield',  text: 'ガードがとても硬い', armor: 0.8, mod: { power: 1.05 } },
    '爆': { effect: 'explode', text: '当たると爆発。自分も少し巻き込まれる' },
    '犬': { effect: 'bite',    text: 'ワンと鳴いて追加で噛みつく', mod: { power: 1.2 } },
    '無': { effect: 'nothing', text: 'ときどき無の境地に入って、相手の攻撃も効果も受けつけない' },
    '神': { effect: 'god',     text: '強すぎる。そのかわり動きがすごく遅い',
            mod: { power: 2.2, size: 1.15, move: 0.55, startup: 1.7, recovery: 1.5 } },

    // ---- 追加の27字 ----
    // 状態異常
    '毒': { effect: 'poison',   text: '当てると相手が長いあいだ毒でじわじわ減る' },
    '眠': { effect: 'sleep',    text: 'ときどき相手が眠る。殴られると起きる' },
    '愛': { effect: 'charm',    text: '当たると相手がメロメロになり攻撃してこない', mod: { power: 0.8 } },
    '時': { effect: 'timestop', text: 'たまに相手の時間が止まる' },
    '辛': { effect: 'spicy',    text: '当たると相手が火を吹いて走り回る' },
    // 攻撃強化
    '怒': { effect: 'rage',     text: 'HPが減るほど攻撃力アップ（最大2倍）' },
    '運': { effect: 'luck',     text: 'ダメージが毎回0〜3倍のおみくじ' },
    '鉄': { effect: 'pierce',   text: '相手のガードを無視してダメージが通る' },
    '斬': { effect: 'crit',     text: '30%でクリティカル（2.5倍）' },
    '拳': { effect: 'fist',     text: 'リーチは短いが、当たるたびにジャブの連打が入る',
            mod: { size: 0.75, startup: 0.4, recovery: 0.35, power: 1.15 } },
    // 防御・移動
    '跳': { effect: 'hop',      text: 'ずっと跳ねていて当たりにくい', mod: { power: 2.0 } },
    '磁': { effect: 'magnet',   text: '相手を少しずつ引き寄せる' },
    '風': { effect: 'wind',     text: 'ダメージは小さいが、相手を端まで吹き飛ばす', mod: { power: 1.35, knockback: 1.5 } },
    '嵐': { effect: 'storm',    text: '当てると竜巻が起きて、相手が真上に吹っ飛ぶ' },
    '罠': { effect: 'trap',     text: '地面に罠を置く。踏んだ相手は動けない' },
    // 武器変化
    '巨': { effect: 'grow',     text: '試合中に武器がどんどん大きくなる' },
    '影': { effect: 'shadow',   text: '影武者。攻撃を受けると、ときどき黒い影が身代わりになる' },
    // 遠距離（弱攻撃が飛び道具になる）
    '弓': { effect: 'arrow',    text: '離れた所から矢を撃つ', ranged: true, mod: { power: 0.8, recovery: 1.15 } },
    '竜': { effect: 'breath',   text: '口から炎を吐く', ranged: true, mod: { recovery: 1.3 } },   // 勝率65%くらいに（1.15だと72%）
    '砲': { effect: 'cannon',   text: '遠くから大砲を一発', ranged: true, mod: { startup: 1.8, recovery: 1.6 } },
    // ネタ
    '猫': { effect: 'cat',      text: '気まぐれでサボる。当たると引っかき連撃' },
    '酔': { effect: 'drunk',    text: 'フラフラ変な動きをするが、攻撃1.5倍', mod: { power: 1.5 } },
    '光': { effect: 'lightspeed', text: '光の速さで動き回り、ときどき光になって一瞬で詰め寄る', mod: { move: 2.0, power: 1.3 } },
    '闇': { effect: 'dark',     text: '画面が暗くなり、相手がでたらめに動く' },

    // ---- 100字に向けて追加した64字 ----
    // sig: 得意技を字の形と関係なく決める / far: いつも前に出っ張る / stretch: 攻撃中だけ伸びる / armor: 受けるダメージ倍率
    // 武器
    '剣': { effect: 'combo3',   text: '正統派。3段の連続斬り' },
    '矛': { effect: 'hoko',     text: '長い突き。ガードした相手を崩してよろけさせる（盾にはもっと効く）', sig: 'thrust', far: 0.25, mod: { power: 1.1, startup: 0.85, recovery: 0.85 } },
    '槍': { effect: 'spear',    text: 'リーチが非常に長い突き', sig: 'thrust', far: 0.35, mod: { power: 1.2, startup: 0.8, recovery: 0.85 } },
    '薙': { effect: 'mow',      text: '横一閃の広い範囲。相手を吹き飛ばす', sig: 'slash', mod: { knockback: 1.8 } },
    '𰻞': { effect: 'stretch',  text: '攻撃の瞬間だけ、麺のように字がびよーんと伸びる', stretch: 0.5, mod: { power: 1.0, recovery: 0.9 } },   // ビャンビャン麺のビャン（58画）
    '鎖': { effect: 'chain',    text: '鎖が相手に巻きついて動きを止め、手元まで引き寄せる' },
    '銃': { effect: 'gun',      text: '小さい弾の3連射', ranged: true, mod: { recovery: 1.2 } },
    '金': { effect: 'gold',     text: '当たると小判が飛び散る。ダメージは毎回ばらつく' },
    '鋼': { effect: 'steel',    text: '受けるダメージが大きく減る。そのかわり遅い', armor: 0.75, mod: { power: 0.85, move: 0.7, startup: 1.2 } },
    '癒': { effect: 'regen',    text: '自分のHPがじわじわ回復する', mod: { power: 0.9 } },
    '魔': { effect: 'magic',    text: '毎回ランダムで炎・氷・雷のどれかの魔法が出る', mod: { power: 0.8 } },
    '屁': { effect: 'fart',     text: 'くさい屁をこく。においをかいだ相手は混乱して、左右が逆になる' },
    '忍': { effect: 'shuriken', text: '手裏剣を飛ばして攻撃する', ranged: true },
    '侍': { effect: 'iai',      text: '近づく相手を一撃で斬る。遠いと踏み込み、飛び道具は斬り落とす', mod: { startup: 0.3, power: 1.6, recovery: 2.2 } },
    // 自然
    '水': { effect: 'slip',     text: '当たった相手が濡れて滑る', mod: { power: 1.5 } },
    '雪': { effect: 'snow',     text: '当たった相手が雪だるまになって転がる' },
    '星': { effect: 'dizzy',    text: '当たった相手が目を回す' },
    '岩': { effect: 'rockthrow', text: 'たまに岩を投げる', mod: { power: 1.25 } },
    '砂': { effect: 'sand',     text: '目つぶし。相手の攻撃が外れやすくなる', mod: { power: 1.3 } },
    '震': { effect: 'quakeT',   text: 'ときどき地震を起こし、地面にいる相手が転ぶ', mod: { power: 1.4 } },
    '波': { effect: 'wave',     text: 'ときどき大波を出して相手を押し流す' },
    '花': { effect: 'flower',   text: '当たった相手に花が咲き、しばらく攻撃しない' },
    // 生き物
    '蛇': { effect: 'coil',     text: '巻きついて動きを止める' },
    '蜂': { effect: 'sting',    text: '2回目に刺したとき大ダメージ' },
    '虫': { effect: 'bugs',     text: '虫がたかって、相手のHPが少しずつ減る' },
    '牛': { effect: 'rush',     text: 'ときどき端から端まで突進する', mod: { power: 1.3 } },
    '馬': { effect: 'swift',    text: '足がとても速い', mod: { move: 1.9, power: 1.45 } },
    '象': { effect: 'stomp',    text: 'ときどき大ジャンプして、上から相手を踏みつぶす', sig: 'smash' },
    '獣': { effect: 'beast',    text: '当てるたびに興奮して、攻撃がどんどん速くなる' },
    '狼': { effect: 'howl',     text: 'HPが減ると遠吠えして速くなる', mod: { power: 1.3 } },
    // からだ・食べ物
    '牙': { effect: 'fangs',    text: '噛みつきの連続攻撃' },
    '爪': { effect: 'claw',     text: '引っかきの3連撃' },
    '蘇': { effect: 'revive',   text: '倒れても1回だけHP1でよみがえる' },
    '麺': { effect: 'slurp',    text: '麺がズルズル伸びて離れた相手にも届き、当たると引き寄せる', stretch: 0.8, mod: { power: 1.1, recovery: 0.9 } },
    // トリック
    '鏡': { effect: 'mirror',   text: '攻撃や飛び道具を跳ね返す', mod: { power: 0.75 } },
    '幻': { effect: 'illusion', text: '攻撃を受けると、ときどき蜃気楼のように消えて背後に現れる' },
    '謎': { effect: 'mystery',  text: '毎回ランダムな効果が出る', mod: { power: 0.85 } },
    // 人物・道具
    '鐘': { effect: 'bell',     text: 'ゴーンと鳴って相手がひるむ' },
    '鎧': { effect: 'armor',    text: '受けるダメージが減る', armor: 0.8, mod: { power: 0.8 } },
    '網': { effect: 'net',      text: '網で相手を捕まえる', mod: { power: 0.85 } },
    '盗': { effect: 'steal',    text: '当てるたびに相手の必殺ゲージを盗む。たまにHPも' },
    // ネタ
    '呪': { effect: 'curse',    text: '相手のHPを少しずつ吸い取る', mod: { power: 0.85 } },
    '滅': { effect: 'doom',     text: '当たるたびに「〇〇すぎて滅！」。ごく低い確率で一撃KO', mod: { power: 1.3 } },
    '薔': { effect: 'thorn',    text: 'トゲがある。殴ってきた相手にチクッと少しダメージを返す' },
    // ネット・流行語など
    '草': { effect: 'laugh',    text: '当たると相手が笑い転げて動けない（www）' },
    '尊': { effect: 'swoon',    text: '当たると相手が「尊い…」と崩れ落ちる' },
    '推': { effect: 'oshi',     text: '推しのうちわが飛んできて、応援されるほど強くなる' },
    '沼': { effect: 'swamp',    text: '足元に沼を作る。ハマった相手は抜け出せない', mod: { power: 1.4 } },
    '鬱': { effect: 'gloom',    text: '当たると相手のやる気が下がり、攻撃しなくなっていく', mod: { power: 0.85 } },
    '卍': { effect: 'boomerang', text: '字がブーメランのように飛んでいき、戻ってくる', ranged: true, mod: { recovery: 1.75 } },
    '恋': { effect: 'love',     text: '恋をして逃げ回り、ハートを投げて攻撃する', ranged: true },
    '叫': { effect: 'shout',    text: '叫び声の衝撃波で相手を吹き飛ばす', mod: { power: 1.2 } },
    '覇': { effect: 'haki',     text: '覇気。近くにいるだけで相手がひるむ' },
    // ---- 入れ替えで追加した11字 ----
    '母': { effect: 'nag',      text: '攻撃のたびに小言が飛んでいき、当たると小ダメージ', mod: { power: 1.3 } },
    '筋': { effect: 'pump',     text: '当てるたびにムキムキになって強くなる（最大1.5倍）' },
    '鮨': { effect: 'sushi',    text: '「へいお待ち！」と、ときどき寿司を投げて攻撃する' },
    '税': { effect: 'tax',      text: '当てると課税され、相手のHPがじわじわ減っていく' },
    '罰': { effect: 'punish',   text: '相手が攻撃を空振りすると、小さな天罰の雷が落ちる' },
    '悪': { effect: 'sneak',    text: 'ときどき相手の背後にワープして不意打ちする' },
    '魂': { effect: 'souls',    text: '人魂が体のまわりを回り、近づいた相手に当たる' },
    '乙': { effect: 'otsu',     text: '「お疲れ様です」と言いながら攻撃。つられた相手がお辞儀して止まる', mod: { power: 1.8 } },
    '鎌': { effect: 'reap',     text: 'HPが3割以下の相手には大ダメージ（刈り取り）', sig: 'slash' },
    '霊': { effect: 'ghost',    text: 'ときどき体が透けて、攻撃をすり抜ける' },
    '蹴': { effect: 'kick',     text: 'ときどき字をボールのように蹴って飛ばす' },
    // ---- 2026-11 の入れ替えで追加した字 ----
    '法': { effect: 'law',      text: '3回当てると起訴して大ダメージ。相手の攻撃を「異議あり！」で消す' },
    '透': { effect: 'vanish',   text: 'ときどき透明になり、攻撃が当たらない' },
    '球': { effect: 'pitch',    text: 'ときどき球を投げる。球は壁ではね返って、何度も当たる' },
  };
  // 英語版の効果説明
  const EN_TEXT = {
    '炎': 'Sets the enemy on fire for a while', '氷': 'Freezes the enemy solid', '雷': 'Fast attacks. Sometimes zaps the enemy stiff',
    '重': 'Sends the enemy flying', '盾': 'Guard is ridiculously tough', '爆': 'Explodes on hit. You get a little singed too',
    '犬': 'Woofs, then bites for bonus damage', '無': 'Sometimes enters Zen mode and ignores all attacks and effects',
    '神': 'Way too strong. But moves super slowly',
    '毒': 'Poisons the enemy for a long, slow drain', '眠': 'Sometimes puts the enemy to sleep. A hit wakes them up', '愛': 'Enemy falls head over heels and stops attacking',
    '時': 'Sometimes stops the enemy\'s time', '辛': 'Enemy breathes fire and runs around screaming',
    '怒': 'The lower your HP, the harder you hit (up to 2x)', '運': 'Every hit is a fortune draw: 0x to 3x damage', '鉄': 'Damage goes right through guard', '斬': '30% chance of a critical (2.5x)',
    '拳': 'Short reach, but every hit adds a flurry of jabs', '跳': 'Never stops bouncing. Hard to hit',
    '磁': 'Slowly pulls the enemy closer', '風': 'Weak hits, but blows the enemy to the edge of the screen',
    '嵐': 'Summons a tornado that launches the enemy straight up', '罠': 'Lays traps. Step on one and you\'re stuck',
    '巨': 'Your weapon keeps growing during the fight', '影': 'Shadow double. Sometimes a black shadow takes the hit for you',
    '弓': 'Shoots arrows from far away', '竜': 'Breathes fire', '砲': 'One big cannon shot from far away',
    '猫': 'Slacks off on a whim. Hits become a scratch combo', '酔': 'Wobbly drunk moves, but 1.5x attack',
    '光': 'Moves at light speed and sometimes flashes right up to the enemy', '闇': 'Lights out. The enemy flails around randomly',
    '剣': 'Classic. A 3-hit sword combo', '矛': 'A long thrust that breaks guards and staggers (even more vs 盾)', '槍': 'Super long-reach stab',
    '薙': 'A wide horizontal slash that blows the enemy away', '𰻞': 'Stretches like a biangbiang noodle when attacking',
    '鎖': 'Chains wrap the enemy up and yank them close', '銃': 'Three-round burst of tiny bullets',
    '金': 'Coins fly everywhere on hit. Damage is a gamble', '鋼': 'Takes much less damage. But slow',
    '癒': 'Slowly heals your HP', '魔': 'Casts a random spell each time: fire, ice or thunder', '屁': 'Lets one rip. Anyone who smells it gets confused and mixes up left and right',
    '忍': 'Throws shuriken', '侍': 'Cuts down anyone who gets close. Dashes in from afar and slices projectiles',
    '水': 'Soaks the enemy so they slip around', '雪': 'Turns the enemy into a rolling snowball',
    '星': 'Makes the enemy see stars', '岩': 'Sometimes hurls a rock',
    '砂': 'Pocket sand! Enemy attacks miss more', '震': 'Sometimes causes an earthquake that trips grounded enemies',
    '波': 'Sometimes summons a huge wave that washes the enemy away',
    '花': 'Flowers bloom on the enemy and they stop attacking for a while',
    '蛇': 'Coils around the enemy and holds them', '蜂': 'The second sting does huge damage',
    '虫': 'Bugs swarm the enemy and nibble their HP', '牛': 'Sometimes charges from one end to the other',
    '馬': 'Super fast feet', '象': 'Sometimes leaps high and stomps the enemy flat from above',
    '獣': 'Gets more excited each hit and attacks faster and faster', '狼': 'Howls and speeds up when HP gets low',
    '牙': 'A chomping combo', '爪': 'A 3-hit scratch combo', '蘇': 'Comes back once with 1 HP after being KO\'d', '麺': 'Noodles stretch to reach far enemies and slurp them in',
    '鏡': 'Reflects attacks and projectiles',
    '幻': 'Sometimes fades like a mirage when hit and reappears behind the enemy',
    '謎': 'A random effect every time',
    '鐘': 'BONNNG! The enemy flinches', '鎧': 'Takes less damage',
    '網': 'Catches the enemy in a net', '盗': 'Steals the enemy\'s super gauge every hit. Sometimes HP too',
    '呪': 'Slowly sucks away the enemy\'s HP', '滅': 'Every hit: "Too ___. DOOM!" A tiny chance of a one-hit KO',
    '薔': 'Thorny. Pricks anyone who hits it',
    '草': 'Enemy can\'t stop laughing and can\'t move (lol)', '尊': 'Enemy collapses going "too precious…"',
    '推': 'Fan cheers fly in. The more support, the stronger you get', '沼': 'Makes a swamp underfoot. Once stuck, no escape',
    '鬱': 'Drains the enemy\'s motivation until they stop attacking', '卍': 'The kanji flies like a boomerang and comes back',
    '恋': 'Falls in love, runs away and throws hearts', '叫': 'A shockwave scream that blows the enemy away',
    '覇': 'Overwhelming aura. Enemies flinch just being nearby',
    '母': 'Every swing sends a nagging line flying. Each one stings a little', '筋': 'Bulks up with every hit (up to 1.5x)',
    '鮨': '"Here you go!" Sometimes throws sushi', '税': 'Taxes the enemy on hit. Their HP slowly drains away',
    '罰': 'When the enemy whiffs an attack, a little bolt of karma strikes them', '悪': 'Sometimes warps behind the enemy for a sneak attack',
    '魂': 'Will-o\'-wisps circle you and burn anyone who gets close', '乙': 'Attacks with a polite "Good work today!" The enemy bows back and freezes',
    '鎌': 'Huge damage to enemies under 30% HP (reap)', '霊': 'Sometimes turns see-through and attacks pass right through',
    '蹴': 'Sometimes kicks the kanji like a soccer ball',
    '法': 'Three hits and you are charged: big damage. "Objection!" cancels attacks',
    '透': 'Sometimes turns invisible so attacks pass through', '球': 'Sometimes throws a ball that bounces off the walls and hits again and again', '龘': 'Breathes 3x the fire of 竜',
  };
  EN_TEXT['龍'] = EN_TEXT['竜'];

  // 特別な漢字100字（隠し字は数えない）
  const SPECIAL_LIST = Object.keys(SPECIALS);
  // 隠し字
  SPECIALS['龍'] = { ...SPECIALS['竜'], mod: { recovery: 1.5, power: 0.8 } };   // 竜と同じ効果（画数が多くて強くなりすぎるので少し弱める）
  SPECIALS['龘'] = { effect: 'breath3', text: '竜の3倍の炎を吐く', ranged: true, mod: { recovery: 2.0, power: 0.6 } };   // 強すぎたので攻撃力を下げる（勝率80%くらい） // 100字見つけると解放
  let unlocked = false;              // 龘 の封印が解けているか（game.js が決める）
  let godOpen = false;               // 神 の封印が解けているか（勝ち抜きで10連勝。game.js が決める）
  const locked = (ch) => (ch === '龘' && !unlocked) || (ch === '神' && !godOpen);

  function chars(str) { return [...(str || '').trim()]; }
  function isKanji(ch) { return /^\p{Script=Han}$/u.test(ch); }

  function validate(str) {
    const cs = chars(str);
    if (cs.length === 0) return { ok: false, error: '' };
    if (cs.length > 1) return { ok: false, error: L("１文字だけにしてね", "Just one character, please") };
    if (!isKanji(cs[0])) return { ok: false, error: L("それは漢字じゃない！", "That's not a kanji!") };
    return { ok: true, ch: cs[0] };
  }

  function make(ch) {
    let strokes = strokeMap.get(ch), estimated = false;
    if (strokes == null) { strokes = estimateStrokes(ch); estimated = true; }
    const t = Math.max(0, Math.min(1, (strokes - 1) / 29));
    const w = {
      ch, strokes, estimated,
      size: 72 + t * 66,           // 武器の文字サイズ(px) = 大きさ・リーチ
      power: 6 + t * 8,           // 弱攻撃のダメージ
      startup: 4 + t * 14,         // 攻撃が出るまでのフレーム
      recovery: 8 + t * 16,        // 攻撃後のスキ
      move: 5.2 - t * 2.4,         // 歩く速さ
      knockback: 3 + t * 9,
      guardMul: 0.25,              // ガード時に受けるダメージ倍率
      effect: null, effectText: L("なし", "None"),
    };
    // 30画を超える字はさらに巨大化（たいと 84画 で画面の半分くらい）
    const extra = Math.max(0, Math.min(strokes, 84) - 30);
    if (extra) {
      w.size += extra * 1.2; w.power += extra * 0.1;
      w.startup += extra * 0.15; w.recovery += extra * 0.15; w.move = Math.max(1.6, w.move - extra * 0.02);
      w.effectText = L("デカすぎる", "WAY too big");
    }
    const sp = locked(ch) ? null : SPECIALS[ch];
    if (locked(ch)) w.effectText = ch === '神' ? L('？？？（勝ち抜きで10連勝すると封印が解ける）', '??? (Win 10 in a row in Survival to unseal it)') : '？？？';
    if (sp) {
      w.effect = sp.effect; w.effectText = L(sp.text, EN_TEXT[ch] || sp.text); w.ranged = !!sp.ranged;
      for (const k in (sp.mod || {})) w[k] *= sp.mod[k];
      if (sp.effect === 'shield') w.guardMul = 0.03;
    }
    w.shape = shapeOf(ch, strokes);
    w.signature = SHAPES[w.shape].move; w.shapeText = SHAPES[w.shape].text;
    if (sp) {
      if (sp.sig) {
        w.signature = sp.sig;
        w.shapeText = L({ slash: "横薙ぎが得意", thrust: "突きが得意", smash: "叩きつけが得意" }[sp.sig] + "（字の効果）", { slash: "Good at sweeps", thrust: "Good at stabs", smash: "Good at slams" }[sp.sig] + " (kanji effect)");
      }
      w.far = sp.far || 0; w.stretch = sp.stretch || 0; w.armor = sp.armor || 1; w.cloud = !!sp.cloud;
    }
    // 形の特徴：軽い字はとても速く振れる、縦棒の字はリーチが長く突きが得意、囲みの字はガードが硬い
    w.traits = traitsOf(ch, strokes);
    if (w.traits.light) { w.startup *= 0.8; w.recovery *= 0.75; }
    if (w.traits.pole) { w.far = (w.far || 0) + 0.06; if (!(sp && sp.sig)) w.signature = 'thrust'; }
    if (w.traits.hole) w.guardMul *= 0.5;
    w.baseSize = w.size; w.basePower = w.power;
    w.startup = Math.round(w.startup);
    w.recovery = Math.round(w.recovery);
    w.active = 6;
    w.strongStartup = Math.round(w.startup * 2 + 8);
    w.strongPower = w.power * 2;

    const stars = (v) => '★'.repeat(v) + '☆'.repeat(5 - v);
    const clamp5 = (v) => Math.max(1, Math.min(5, Math.round(v)));
    w.stars = {
      power: w.power === 0 ? L("☆☆☆☆☆（ゼロ）", "☆☆☆☆☆ (zero)") : stars(clamp5(w.power / 16 * 5)),
      speed: stars(clamp5(6 - (w.startup + w.recovery) / 9)),
      reach: stars(clamp5(w.size / 150 * 5)),
    };
    return w;
  }

  // CPUが選ぶ漢字（特別な字＋画数ばらばらの字）
  const CPU_SPECIAL = [...SPECIAL_LIST, '龍'];
  const CPU_PLAIN = [...'一二三力刀山川木手口目田虎鼠寿腹豆鍋髪鬼麦車電議龜齉石紙机椅本林森海空月日火土竹米肉犬猿雲'].filter((c) => !(c in SPECIALS));
  // 特別な字は10%、ふつうの字は90%で選ぶ
  function randomForCpu() {
    const pool = Math.random() < 0.1 ? CPU_SPECIAL.filter((c) => !locked(c)) : CPU_PLAIN;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  window.Weapon = {
    FONT_FAMILY, validate, make, randomForCpu, SPECIAL_LIST,
    isSpecial: (ch) => ch in SPECIALS && !locked(ch),
    setUnlocked: (v) => { unlocked = !!v; },
    setGodUnlocked: (v) => { godOpen = !!v; },
  };
})();
