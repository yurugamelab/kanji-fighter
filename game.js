// 漢字ファイター - ゲーム本体（オートバトル・1回戦）
(function () {
  const GRAV = 0.8;
  const ROUND_FRAMES = 60 * 60;            // 60秒
  const DMG = 0.6;                          // ダメージ全体の倍率（下げるほど試合が長くなり、何が起きたか分かりやすい）
  const ARM = 40;                          // 肩から手までの長さ
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const sign = (v) => (v >= 0 ? 1 : -1);
  const { L, T } = I18N;                    // 日本語／英語（i18n.js）
  const EN = I18N.en;

  // ---------- 画面サイズ（縦長ならスマホ用の縦レイアウト）----------
  let W = 960, H = 540, GROUND = 470, portrait = false;
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    portrait = vh > vw;
    if (portrait) {
      W = 480;
      H = Math.round(Math.max(700, Math.min(1100, W * vh / vw)));
      GROUND = Math.round(H * 0.7);
    } else {
      W = 960; H = 540; GROUND = 470;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (match) for (const f of [match.p, match.c]) {
      f.x = Math.max(40, Math.min(W - 40, f.x));
      if (f.onGround || f.y > GROUND) f.y = GROUND;
    }
  }
  window.addEventListener('resize', layout);

  // ---------- 素材（無ければ図形で描く）----------
  function loadImg(src) {
    const img = new Image();
    img.onerror = () => { img.failed = true; };
    img.src = src;
    return img;
  }
  const IMG = { bg: loadImg('img/dojo_wide.jpg'), bgTall: loadImg('img/dojo_tall.jpg') };
  const ready = (img) => !img.failed && img.complete && img.naturalWidth > 0;

  const NO_INPUT = { left: false, right: false, up: false, down: false, weak: false, strong: false, guard: false };

  // ---------- 演出 ----------
  let particles = [], texts = [], projectiles = [], traps = [], fxs = [], smites = [], shake = 0, hitstop = 0;
  let punch = 0;                           // 強い打撃でカメラがぐっと寄る量
  // 金：小判（跳ねて転がる）と紙幣（ひらひら舞う）
  function coins(x, y, n) { for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-6, 6), vy: rand(-11, -4), g: 0.45, life: 70 + Math.random() * 30, color: '#f2c230', r: 7, coin: true, spin: Math.random() * 6, bounce: true }); }
  function bills(x, y, n, spread) { for (let i = 0; i < n; i++) particles.push({ x: x + rand(-spread, spread), y: y + rand(-spread * 0.6, spread * 0.3), vx: rand(-3, 3), vy: rand(-6, -1), g: 0.06, life: 80 + Math.random() * 40, color: '#d9c9a0', r: 4, bill: true, rot: Math.random() * 6, vr: rand(-0.2, 0.2) }); }
  // 薔：薔薇の花びら（ひらひら舞う）
  function petals(x, y, n, spread) { for (let i = 0; i < n; i++) particles.push({ x: x + rand(-spread, spread), y: y + rand(-spread * 0.6, spread * 0.4), vx: rand(-4, 4), vy: rand(-6, -1), g: 0.05, life: 70 + Math.random() * 40, color: ['#e8336d', '#c81d4e', '#ff7eb6'][i % 3], r: 4, petal: true, rot: Math.random() * 6, vr: rand(-0.25, 0.25) }); }
  function drawBill(x, y, w, h, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#e3d6ad'; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#7a6a3a'; ctx.lineWidth = Math.max(1, h * 0.07); ctx.strokeRect(-w / 2 + h * 0.12, -h / 2 + h * 0.12, w - h * 0.24, h - h * 0.24);
    ctx.fillStyle = '#b89a5a'; ctx.beginPath(); ctx.arc(w * 0.24, 0, h * 0.27, 0, TAU); ctx.fill();
    if (h > 24) { ctx.fillStyle = '#5a4a1a'; ctx.font = `bold ${Math.round(h * 0.34)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('壱万円', -w * 0.12, 0); }
    ctx.restore();
  }
  function spark(x, y, color, n, speed, opt) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * s + ((opt && opt.vx) || 0), vy: Math.sin(a) * s - 1 + ((opt && opt.vy) || 0),
        life: 20 + Math.random() * 20, color, r: 2 + Math.random() * 4, g: opt && opt.g != null ? opt.g : 0.2, ch: opt && opt.ch });
    }
  }
  // 文字の幅のめやす（日本語は1文字＝大きさくらい、英数字は半分くらい）
  const textW = (str, size) => { let n = 0; for (const ch of str) n += /[\x00-\x7f]/.test(ch) ? 0.6 : 1; return n * size; };
  function popText(x, y, str, color, size) {
    str = T(str); size = size || 28;
    // 出ている文字（ダメージの数字・コメント）と重なるなら、重ならない所まで上にずらす
    const w = textW(str, size);
    for (let k = 0; k < 6; k++) {
      const hit = texts.find((t) => t.life > 8 && Math.abs(t.x - x) < (textW(t.str, t.size) + w) / 2 + 4 && Math.abs(t.y - y) < (t.size + size) / 2 + 2);
      if (!hit) break;
      y = hit.y - (hit.size + size) / 2 - 4;
    }
    texts.push({ x, y, str, color: color || '#222', size, life: 50 });
  }
  const sfx = (name, a, b) => { if (window.Sfx) Sfx.play(name, a, b); };

  // ---------- 見つけた特別な漢字（この端末のブラウザだけに保存）----------
  // その字で勝ったら「発見」（図鑑に登録）。100字そろうと隠し字「龘」の封印が解ける
  const FOUND_KEY = 'kanji-battler-found';
  const SPECIAL_SET = new Set(Weapon.SPECIAL_LIST), TOTAL = SPECIAL_SET.size;
  let found = new Set();
  try {
    const v = JSON.parse(localStorage.getItem(FOUND_KEY) || '[]');
    if (Array.isArray(v)) found = new Set(v.filter((c) => SPECIAL_SET.has(c)));
  } catch (e) {}
  const allFound = () => found.size >= TOTAL;
  const inDex = (ch) => (ch === '龘' ? Weapon.isSpecial('龘') : found.has(ch));   // 図鑑に入っているか（龘は100字そろうと入る）
  Weapon.setUnlocked(allFound());
  function recordFound(ch) {
    if (ch === '龍') ch = '竜';                    // 龍は竜の別の字体。どちらで戦っても同じ字として見つけたことになる
    if (!SPECIAL_SET.has(ch) || !Weapon.isSpecial(ch) || found.has(ch)) return null;   // 封印中の字は数えない
    const before = allFound();
    found.add(ch);
    try { localStorage.setItem(FOUND_KEY, JSON.stringify([...found])); } catch (e) {}
    const unlockedNow = !before && allFound();
    if (unlockedNow) Weapon.setUnlocked(true);
    return { ch, count: found.size, unlockedNow };
  }
  function updateHint() { $('found-hint').textContent = L(`特別な漢字 発見 ${found.size}／${TOTAL}　図鑑を見る ›`, `Special kanji found: ${found.size}/${TOTAL}  Open Kanjidex ›`); }

  // ---------- 漢字図鑑の記録（初めて使った日・その字での勝ち数）----------
  const DEX_KEY = 'kanji-fighter-dex';
  let dex = {};
  try { const v = JSON.parse(localStorage.getItem(DEX_KEY) || '{}'); if (v && typeof v === 'object') dex = v; } catch (e) {}
  // 日付は「2026-11-17」の形で保存し、見せるときに言語に合わせる（前の版の「2026年11月17日」も読める）
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function showDate(s) {
    const m = String(s || '').match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (!m) return s;
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return L(`${y}年${mo}月${d}日`, new Date(y, mo - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
  }
  function recordPlay(ch, won) {
    if (ch === '龍') ch = '竜';
    if (!SPECIAL_SET.has(ch) || !Weapon.isSpecial(ch)) return;
    const e = dex[ch] || (dex[ch] = { first: today(), wins: 0 });
    if (won) e.wins = (e.wins || 0) + 1;
    try { localStorage.setItem(DEX_KEY, JSON.stringify(dex)); } catch (e2) {}
  }
  // 未発見の字のヒント（字の仲間ごと）
  const DEX_HINTS = [
    [L('火や熱に関係する字', 'Something about fire or heat'), '炎爆辛'],
    [L('天気や空に関係する字', 'Something about weather or the sky'), '雷風嵐雪星光'],
    [L('自然の中にあるもの', 'Something found in nature'), '氷水岩砂震波花闇薔'],
    [L('生き物', 'A living creature'), '犬猫蛇蜂虫牛馬象獣狼竜'],
    [L('からだの一部', 'A body part'), '拳牙爪筋'],
    [L('武器や防具', 'A weapon or armor'), '剣矛槍薙銃弓砲盾鎧鋼鉄鎖斬鎌'],
    [L('人や職業', 'A person or a job'), '忍侍神盗母'],
    [L('気持ちに関係する字', 'Something about feelings'), '怒愛恋尊鬱叫'],
    [L('食べ物・飲み物', 'Food or drink'), '麺𰻞鮨'],
    [L('身のまわりの道具', 'An everyday object'), '鐘網鏡金磁罠球'],
    [L('不思議な力', 'A mysterious power'), '魔呪幻謎影蘇癒滅運時無霊魂'],
    [L('動きやようす', 'A movement or a state'), '跳重巨眠覇蹴酔透'],
    [L('世の中のきまり', 'How society works'), '税罰悪法'],
    [L('ネットでよく使う言葉', 'Japanese internet slang'), '草推沼卍乙'],
    [L('体に悪いもの', 'Something bad for your body'), '毒'],
    [L('からだから出るもの', 'Something that comes out of your body'), '屁'],
  ];
  // 未発見の字のヒント：誰でも知っている特徴を2つほど並べ、推理して当てられるように（その字そのものや、その字を使った言葉は書かない）
  const DEX_DEF = {
    "炎": ["キャンプファイヤーで赤くゆらめく。近づくと熱い", "It flickers red at a campfire. Get close and it's hot"],
    "氷": ["夏にシロップをかけてシャリシャリ食べる。ジュースに入れるとカランと鳴る", "Shaved desserts are made of it; it clinks in your juice"],
    "雷": ["夏の夕立でピカッと光る。落ちると停電することも", "It flashes in a summer storm. When it strikes, the power can go out"],
    "重": ["持ち上げると「うっ」となる。羽毛とは正反対", "Lift it and you go \"oof.\" The opposite of a feather"],
    "盾": ["騎士が剣と反対の手に持ち、敵の攻撃を受け止める", "A knight holds it in the hand without the sword to block attacks"],
    "爆": ["花火やダイナマイトで「ドカーン」と起こる", "The big \"BOOM\" of fireworks and dynamite"],
    "犬": ["散歩が大好きで、「お手」や「おすわり」ができるペット", "A pet that loves walks and can \"shake\" and \"sit\""],
    "無": ["何もない、からっぽの状態。数字で言えばゼロ", "Nothing at all, totally empty. Zero, as a number"],
    "神": ["初もうでで手を合わせて、お願いごとをする相手", "The one you put your hands together and make wishes to at New Year's shrine visits"],
    "毒": ["白雪姫のりんごに入っていた。飲むと命があぶない", "What was in Snow White's apple. Swallow it and your life is in danger"],
    "眠": ["夜、ふとんに入って目を閉じると訪れる。授業中にも来る", "It comes when you get into bed and close your eyes. It also visits during class"],
    "愛": ["ハートマークで表す、相手を大切に思う気持ち", "The caring feeling a heart symbol stands for"],
    "時": ["チクタクと針が刻むもの。過ぎると戻ってこない", "What a clock's hands tick away. Once it passes, it never comes back"],
    "辛": ["カレーの甘口・中口のその先。口から火が出そうな味", "Past mild and medium curry; a taste that makes you breathe fire"],
    "怒": ["顔が真っ赤になり、頭から湯気が出そうな気持ち", "The feeling that turns your face red and makes steam come out of your head"],
    "運": ["くじ引きやおみくじで試される。実力ではどうにもならない", "What a lottery or fortune slip tests. Skill can't change it"],
    "鉄": ["磁石にくっつく金属。さびると赤茶色になる", "A metal that sticks to magnets. It turns reddish brown when it rusts"],
    "斬": ["侍が刀を抜いて、相手をバッサリやること", "A samurai drawing his sword and slashing someone down"],
    "拳": ["じゃんけんの「グー」の手。パンチをするときの形", "Your hand when you throw rock; the shape you make to punch"],
    "跳": ["カエルやウサギが得意。なわとびでもする", "Frogs and rabbits are great at it. You do it in jump rope, too"],
    "磁": ["冷蔵庫にメモを貼る道具が持つ、鉄を引きよせる力", "The iron-pulling force of the things that stick notes on your fridge"],
    "風": ["目には見えないが、こいのぼりを泳がせ、帽子を飛ばす", "You can't see it, but it makes carp streamers swim and blows hats away"],
    "嵐": ["強い雨と風が吹き荒れる天気。台風が来るとこうなる", "Weather with wild rain and wind, like when a typhoon hits"],
    "罠": ["獲物をつかまえるために仕掛ける。落とし穴もその一つ", "Set up to catch prey; a pit you fall into is one kind"],
    "巨": ["見上げるほど、とても大きいこと。恐竜やクジラのサイズ", "So big you have to look up; dinosaur- or whale-sized"],
    "影": ["光が当たると足元にできる黒い形。夕方は長くのびる", "The dark shape at your feet in the light; it stretches long in the evening"],
    "弓": ["しなる木に糸を張った道具で、矢を飛ばす", "A bent piece of wood with a string, used to shoot arrows"],
    "竜": ["火を吹いて空を飛ぶ伝説の生き物。干支の一つ", "A legendary fire-breathing beast that flies; one of the zodiac animals"],
    "砲": ["お城や戦艦にある、大きな弾を「ドーン」と撃つ筒", "The tube on castles and battleships that fires big shells with a boom"],
    "猫": ["「ニャー」と鳴き、こたつで丸くなる気まぐれなペット", "The fickle pet that says \"meow\" and curls up under the heated table"],
    "酔": ["お酒を飲みすぎると、顔が赤くなってこうなる。乗り物でなる人もいる", "Too much to drink and your face turns red. Some people get it on car rides, too"],
    "光": ["太陽や電球から出て、まわりを明るくする", "It comes from the sun and light bulbs and brightens things up"],
    "闇": ["明かりがひとつもない、真っ暗な状態", "Total darkness with not a single light on"],
    "剣": ["勇者や騎士が持つ、両側に刃のついたまっすぐな刀", "A straight, double-edged blade carried by heroes and knights"],
    "矛": ["長い柄の先に刃がついた昔の武器。「どんな盾も突き通す」と自慢された", "An old long-handled weapon with a blade, bragged to pierce any shield"],
    "槍": ["長い棒の先にとがった刃をつけ、突いて使う武器", "A long pole with a pointed blade, used for stabbing"],
    "薙": ["長い刃の武器を横に大きく振って、なぎ払うこと", "Swinging a long-bladed weapon sideways to sweep everything down"],
    "𰻞": ["中国の麺料理の名前に使う画数が多い漢字。予測変換で出ないとき、他に入力方法はないだろうか。", "A kanji with a huge number of strokes, used in the name of a Chinese noodle dish. If it won't show up in your predictive text, is there another way to enter it?"],
    "鎖": ["金属の輪をいくつもつなげたもの。自転車にも使われている", "Metal rings linked one after another; bikes use one too"],
    "銃": ["引き金を引くと「バン」と弾が出る武器", "A weapon that goes \"bang\" when you pull the trigger"],
    "金": ["オリンピックで1位がもらうメダルの色。小判の材料", "The color of the first-place medal; what old gold coins were made of"],
    "鋼": ["鉄をきたえて、さらに硬く強くしたもの。刀やバネに使う", "Iron forged to be even harder and tougher; used for swords and springs"],
    "癒": ["温泉やペットのおかげで、疲れた心や傷がよくなること", "When hot springs or pets make your tired heart or wounds feel better"],
    "魔": ["ほうきで空を飛ぶ女の人や、ラスボスが使う、悪くて不思議な力", "The wicked, mysterious power of witches and demon lords"],
    "屁": ["おしりから出る、くさいガス。音がすることも", "The smelly gas that comes out of your bottom, sometimes with a sound"],
    "忍": ["黒い服で姿を隠し、手裏剣を投げる日本の隠密", "The black-clad Japanese spy who hides and throws shuriken"],
    "侍": ["ちょんまげで刀を二本差した、昔の日本の武士", "A warrior of old Japan with a topknot and two swords"],
    "水": ["のどがかわいたら飲む、すきとおった液体。川や海を満たす", "The clear liquid you drink when thirsty; it fills rivers and seas"],
    "雪": ["冬に空から白く降ってくる。積もるとだるまやかまくらが作れる", "It falls white from the winter sky. Enough of it and you can build a snowman"],
    "星": ["夜空でキラキラ光る。流れたときに願いごとをする", "It twinkles in the night sky. When one falls, you make a wish"],
    "岩": ["山や海辺にある、大きくてごつごつした石のかたまり", "A big, rugged chunk of stone in the mountains or by the sea"],
    "砂": ["浜辺や公園の遊び場にある、さらさらした細かい粒", "The fine, silky grains at the beach or in a playground box"],
    "震": ["地面がグラグラ揺れること。スマホがブルブルすることも", "The ground shaking hard; also your phone buzzing"],
    "波": ["海で寄せては返すもの。サーファーが乗る", "What rolls in and out at the sea; surfers ride it"],
    "花": ["春に咲いて、ミツバチがやってくる色あざやかなもの", "The colorful thing that blooms in spring and draws bees"],
    "蛇": ["手足がなく、にょろにょろ進む長い生き物。干支の一つ", "A long, legless creature that slithers; one of the zodiac animals"],
    "蜂": ["黄色と黒のしまもようで、おしりの針で刺す虫", "A yellow-and-black striped insect that stings with its tail"],
    "虫": ["カブトムシやバッタの仲間。夏休みにあみで捕まえる", "The group that beetles and grasshoppers belong to; you catch them with a net in summer"],
    "牛": ["「モー」と鳴き、ミルクを出してくれる大きな動物", "The big animal that says \"moo\" and gives milk"],
    "馬": ["人を背中に乗せて走る、たてがみのある動物。ニンジンが好物", "A maned animal that carries people on its back and runs in horse races"],
    "象": ["長い鼻と大きな耳を持つ、陸でいちばん大きな動物", "The biggest land animal, with a long trunk and big ears"],
    "獣": ["毛におおわれた四本足の、野生の動物", "A wild, furry, four-legged animal"],
    "狼": ["群れでくらし、満月の夜に遠吠えする野生の動物", "A wild animal that lives in packs and howls at the full moon"],
    "牙": ["ライオンや吸血鬼の口から見える、長くてするどい歯", "The long, sharp teeth you see in a lion's or vampire's mouth"],
    "爪": ["指の先に生えていて、のびたら切る。猫はとぐ", "It grows at the tips of your fingers and you trim it; cats sharpen theirs"],
    "蘇": ["死んだはずのものが、もう一度生き返ること", "Coming back to life after you were supposed to be dead"],
    "麺": ["ラーメンやうどんのように、細長くてズルズルすする食べ物", "Long, thin food you slurp, like ramen or udon"],
    "鏡": ["顔を映して見る、つるつるの板。洗面所にある", "The smooth glass you see your face in, found by the bathroom sink"],
    "幻": ["本当はないのに見えてしまうもの。砂漠のオアシスなど", "Something you see that isn't really there, like a desert oasis"],
    "謎": ["答えがわからない、ふしぎなこと。名探偵が解く", "A puzzling thing with no answer yet, for a great detective to solve"],
    "鐘": ["お寺にある大きな金属の鳴り物。大みそかに108回つく", "The big metal bell at a temple, struck 108 times on New Year's Eve"],
    "鎧": ["昔の武士や騎士が、戦で体を守るために着た金属の服", "The metal suit warriors and knights wore to protect themselves in battle"],
    "網": ["糸を編んですき間を作った道具。魚や虫をとるのに使う", "A tool of knotted string full of holes, used to catch fish or bugs"],
    "盗": ["人のものを、だまってこっそり持っていくこと。泥棒がする", "Quietly taking someone else's things without asking; what a thief does"],
    "呪": ["わら人形にくぎを打つように、うらんで悪いことを願うこと", "Wishing harm on someone out of a grudge, like nailing a straw doll"],
    "滅": ["すっかりなくなって、二度ともどらないこと。恐竜の運命", "Being wiped out for good, like the dinosaurs"],
    "薔": ["とげがあって香りのよい、愛を伝える花。その名前の一文字目", "The first character in the name of the thorny, fragrant flower given to show love"],
    "草": ["地面に生える緑の植物。ネットでは「笑」の意味でも使う", "Green plants growing on the ground; online it also means \"lol\""],
    "尊": ["とてもありがたく、大切なこと。推しを見て思わず言う", "Something precious and worthy of reverence; what you blurt out seeing your fave"],
    "推": ["いちばん応援している人。グッズを集めたりする", "The person you support the most, the one you collect goods for"],
    "沼": ["泥がたまった深い水たまり。ハマって抜け出せない趣味のことも", "A deep, muddy pool; also a hobby you get stuck in and can't escape"],
    "鬱": ["気分がしずんで晴れないこと。画数がとても多い", "A sunken, gloomy mood. It has a huge number of strokes"],
    "卍": ["地図でお寺を表す記号。かぎの形が回るように並ぶ", "The map symbol for a temple; hooked arms arranged as if spinning"],
    "恋": ["好きな人のことを考えて、胸がドキドキすること", "Your heart pounding as you think about someone you like"],
    "叫": ["ジェットコースターなどで、大声を張り上げること", "Yelling at the top of your voice, like on a roller coaster"],
    "覇": ["戦いに勝ち抜いて、天下やチャンピオンの座を手に入れること", "Winning every battle to rule the land or take the championship"],
    "母": ["お父さんの奥さん。「早く寝なさい」と言う人", "Dad's wife; the one who tells you to go to bed"],
    "筋": ["体を動かす肉のすじ。きたえるとムキムキになる", "The fibers that move your body; train them and you bulk up"],
    "鮨": ["酢飯の上に魚の切り身をのせた料理。回るお店もある", "Fish slices on vinegared rice; some shops serve it on a conveyor belt"],
    "税": ["国や町に納めるお金。買い物をすると10%足される", "Money paid to the government; 10% gets added when you shop"],
    "罰": ["悪いことをしたときに受ける、こらしめ", "The punishment you get for doing something wrong"],
    "悪": ["よくないこと。正義のヒーローが戦う相手", "Something bad; what the heroes of justice fight"],
    "魂": ["体に宿る心のもと。死ぬと体から抜けるといわれる", "The spirit inside your body, said to leave it when you die"],
    "乙": ["ネットで「おつかれさま」の意味で使う一文字。くねっとした形", "The single character used online for \"good work\"; it has a wiggly shape"],
    "鎌": ["草や稲を刈る三日月形の刃の道具。死神も持っている", "A crescent-bladed tool for cutting grass and rice; the Grim Reaper carries one"],
    "霊": ["死んだ人のたましい。夜に出るお化けのこと", "The soul of someone who died; ghosts and phantoms"],
    "蹴": ["足で強く打つこと。サッカーでボールにすること", "Striking hard with your foot, like a soccer ball"],
    "法": ["国のきまりをまとめたもの。破ると罰を受ける。弁護士や裁判官が使う", "The rules of a country. Break them and you're punished. Lawyers and judges live by them"],
    "透": ["ガラスや澄んだ水のように、向こう側が見えること", "Being see-through, like glass or clear water"],
    "球": ["ボールのこと。投げたり打ったり蹴ったりする、まるいもの", "A ball: the round thing you throw, hit or kick"],
  };
  const hintOf = (ch) => {
    const h = DEX_HINTS.find(([, s]) => s.includes(ch)), d = DEX_DEF[ch];
    const cat = h ? h[0] : L('見当もつかない字', 'No idea at all');
    const text = d ? L(d[0], d[1]) : cat;                          // 字の仲間は出さない（説明だけで推理する）。説明が無い字だけ仲間を出す
    // 神：封印されている間は、ヒントに解放条件も添える
    if (ch === '神' && !godOpen) return text + L('。封印されていて、勝ち抜きで10連勝すると最終結果で封印が解ける', '. It is sealed: win 10 in a row in Survival to unseal it in the final results');
    return text;
  };

  // ---------- 勝ち抜きの最高記録 ----------
  const BEST_KEY = 'kanji-fighter-best';
  let best = { wins: 0, ch: '' };
  try { const v = JSON.parse(localStorage.getItem(BEST_KEY) || 'null'); if (v && v.wins >= 0) best = v; } catch (e) {}
  // 神：勝ち抜きで10連勝すると封印が解ける（前の版で10連勝していた人は、最初から解けている）
  const GOD_KEY = 'kanji-fighter-god';
  let godOpen = best.wins >= 10;
  try { if (localStorage.getItem(GOD_KEY) === '1') godOpen = true; } catch (e) {}
  Weapon.setGodUnlocked(godOpen);
  function openGod() {
    if (godOpen) return false;
    godOpen = true; Weapon.setGodUnlocked(true);
    try { localStorage.setItem(GOD_KEY, '1'); } catch (e) {}
    return true;
  }
  function saveBest(wins, ch) {
    if (wins <= best.wins) return false;
    best = { wins, ch };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) {}
    return true;
  }

  // 勝因に出す効果の短い名前
  const EFFECT_NAME = {
    burn: 'やけど', freeze: '凍結', stun: 'しびれ', heavy: '吹っ飛ばし', shield: '鉄壁ガード', heal: '回復',
    explode: '爆発', bite: '噛みつき', god: '神の力', nothing: '無', poison: '毒', sleep: '眠り', laugh: '笑い', charm: 'メロメロ',
    timestop: '時間停止', spicy: '激辛', rage: '怒り', luck: 'おみくじ', double: '倍々パワー', pierce: 'ガード無視',
    crit: 'クリティカル', fist: '連打', hop: 'ぴょんぴょん', fly: '空中戦', magnet: '磁力', wind: '突風', storm: '嵐',
    trap: '罠', grow: '巨大化', shadow: '影武者', arrow: '矢', breath: '炎の息', cannon: '大砲', cat: '引っかき',
    drunk: '酔っぱらいパワー', flash: '目くらまし', dark: '暗闇',
    combo3: '3段斬り', bleed: '出血', spear: '長槍', mow: '横一閃', stretch: '伸びる字', chain: '鎖の引き寄せ', gun: '3連射',
    gold: '成金パンチ', steel: '鋼の体', regen: '自然回復', magic: '魔法', fart: 'くさい屁', shuriken: '手裏剣', iai: '居合',
    slip: 'ツルツル', snow: '雪だるま', dizzy: 'ピヨり', rock: '岩の硬さ', sand: '目つぶし', quakeT: '地震', wave: '大波',
    flower: 'お花畑', coil: '巻きつき', sting: '二度刺し', bugs: '虫', rush: '突進', swift: '俊足', stomp: '踏みつけ',
    dive: '急降下', flop: 'ビチビチ', howl: '遠吠え', fangs: '噛みつき連打', claw: '引っかき3連', revive: '復活',
    sticky: 'ねばねば', slurp: 'すすり込み', mirror: '反射', vanish: '透明化', illusion: '分身', dual: '2連撃',
    split: '分裂', mystery: '謎の力', bell: '鐘', umbrella: '傘', armor: '鎧', net: '網', thread: '糸縛り', curse: '呪い',
    doom: '滅', snooze: '居眠り回復', slow: '鈍足', speed: '超高速', grass: '草', swoon: '尊さ', oshi: '推しの応援',
    swamp: '沼', gloom: '鬱', beast: '野生', boomerang: 'ブーメラン', love: '恋', shout: '叫び', haki: '覇気', breath3: '三倍ブレス', hoko: 'ガード崩し', steal: '盗み',
    nag: '小言', pump: 'パンプアップ', sushi: '寿司投げ', tax: '課税', punish: '小さな天罰', sneak: '不意打ち', souls: '人魂',
    otsu: 'お疲れ様', reap: '刈り取り', ghost: 'すり抜け', kick: 'シュート', rockthrow: '投石',
    lightspeed: '光速', law: '法の裁き', pitch: '投球',
  };

const EFFECT_NAME_EN = {
  burn: 'burn', freeze: 'freeze', stun: 'zap', heavy: 'knockback', shield: 'iron guard', heal: 'healing',
  explode: 'explosion', bite: 'bite', god: 'divine power', nothing: 'nothingness', poison: 'poison', sleep: 'sleep', laugh: 'laughter', charm: 'crush',
  timestop: 'time stop', spicy: 'spice', rage: 'rage', luck: 'fortune', double: 'doubling power', pierce: 'guard break',
  crit: 'critical', fist: 'punch spam', hop: 'bouncing', fly: 'air combat', magnet: 'magnetism', wind: 'gust', storm: 'tornado',
  trap: 'trap', grow: 'growth', shadow: 'shadow double', arrow: 'arrows', breath: 'fire breath', cannon: 'cannon', cat: 'scratching',
  drunk: 'drunken power', flash: 'blinding flash', dark: 'darkness',
  combo3: '3-hit combo', bleed: 'bleeding', spear: 'long spear', mow: 'wide slash', stretch: 'stretchy kanji', chain: 'chain yank', gun: 'triple shot',
  gold: 'money punch', steel: 'steel body', regen: 'regeneration', magic: 'magic', fart: 'stink', shuriken: 'shuriken', iai: 'quickdraw',
  slip: 'slipperiness', snow: 'snowball', dizzy: 'dizziness', rock: 'rock hardness', sand: 'pocket sand', quakeT: 'earthquake', wave: 'big wave',
  flower: 'flower power', coil: 'coiling', sting: 'double sting', bugs: 'bugs', rush: 'charge', swift: 'speed', stomp: 'stomp',
  dive: 'dive bomb', flop: 'flopping', howl: 'howl', fangs: 'chomp combo', claw: 'triple scratch', revive: 'revival',
  sticky: 'stickiness', slurp: 'slurping', mirror: 'reflection', vanish: 'invisibility', illusion: 'decoy', dual: '2-hit combo',
  split: 'splitting', mystery: 'mystery power', bell: 'bell', umbrella: 'umbrella', armor: 'armor', net: 'net', thread: 'thread', curse: 'curse',
  doom: 'doom', snooze: 'nap healing', slow: 'slowness', speed: 'super speed', grass: 'lol', swoon: 'preciousness', oshi: 'fan support',
  swamp: 'swamp', gloom: 'gloom', beast: 'wildness', boomerang: 'boomerang', love: 'love', shout: 'scream', haki: 'aura', breath3: 'triple breath', hoko: 'guard crush', steal: 'pickpocket',
  nag: 'nagging', pump: 'pump-up', sushi: 'sushi toss', tax: 'taxation', punish: 'little karma', sneak: 'sneak attack', souls: 'wisps',
  otsu: 'good work today', reap: 'reaping', ghost: 'phasing', kick: 'kick shot', rockthrow: 'rock toss',
  lightspeed: 'light speed', law: 'the law', pitch: 'pitching',
};
const effectName = (e) => (EN ? EFFECT_NAME_EN[e] : EFFECT_NAME[e]);

// ---------- キャラ ----------
  const STATUS = ['hitstun', 'frozen', 'stunned', 'burn', 'poison', 'sleep', 'laugh', 'charm', 'timestop', 'spicy', 'blind', 'confused', 'nap',
    'down', 'wake', 'backT',
    // 追加の64字で使う状態
    'bleed', 'slip', 'snow', 'bound', 'sticky', 'slowT', 'curse', 'swoon', 'invis', 'dizzy', 'flower', 'bugs', 'squash',
    'fartT', 'rushT', 'inSwamp', 'hitFlash', 'mu',
    // 入れ替えで追加した字で使う状態（税の課税、乙のお辞儀、魂の人魂の間隔）
    'tax', 'bow', 'soulCd', 'thrownSuper', 'kickT',
    // 2026-11 の調整で使う状態（屁のにおい、影武者・異議ありの間隔、屁で吹き飛んで壁に激突）
    'stink', 'shadowCd', 'objCd', 'wallSlam', 'buttT'];

  // ---------- 技 ----------
  // make: 武器の性能から、出だし(su)・当たっている時間(act)・スキ(rec)・威力(pow)・吹っ飛ばし倍率(kb) を作る
  // pose: 段階(0=出だし 1=攻撃中 2=スキ)と進み具合 p(0〜1) から、武器の角度(ang)・伸び(ext)・字の回転(spin)・前への出っ張り(far)
  const R = Math.round, TAU = Math.PI * 2;
  const MOVES = {
    weak: {
      make: (w) => ({ su: w.startup, act: w.active, rec: w.recovery, pow: w.power, kb: 1 }),
      pose: (ph, p) => ph === 0 ? { ang: -0.4, ext: 0.1 } : ph === 1 ? { ang: 0, ext: 1 } : { ang: -0.3 - 0.9 * p, ext: 0.6 },
    },
    strong: {
      make: (w) => ({ su: w.strongStartup, act: w.active + 2, rec: R(w.recovery * 1.5), pow: w.strongPower, kb: 1.5, launch: 0.5, chargeable: true }),
      pose: (ph, p) => ph === 0 ? { ang: -2.3, ext: 0.7 } : ph === 1 ? { ang: -1.7 + 2.3 * p, ext: 1 } : { ang: 0.6 - 1.8 * p, ext: 0.8 },
    },
    jump: {      // ジャンプ攻撃：空中から振り下ろす
      make: (w) => ({ su: Math.max(3, R(w.startup * 0.7)), act: 10, rec: R(w.recovery * 0.8), pow: w.power * 1.5, kb: 1.1, air: true }),
      pose: (ph, p) => ph === 0 ? { ang: -2.0, ext: 0.8 } : ph === 1 ? { ang: -1.4 + 2.4 * p, ext: 1 } : { ang: 1.0 - 1.4 * p, ext: 0.8 },
    },
    anti: {      // 対空：下から振り上げて、相手を浮かせる
      make: (w) => ({ su: R(w.startup * 0.8) + 2, act: 9, rec: R(w.recovery * 1.3), pow: w.power * 1.4, kb: 0.6, launch: 2.2, label: '対空!' }),
      pose: (ph, p) => ph === 0 ? { ang: 0.9, ext: 0.6 } : ph === 1 ? { ang: 0.6 - 2.6 * p, ext: 1 } : { ang: -2.0 + 0.8 * p, ext: 0.8 },
    },
    sweep: {     // 足払い：しゃがんで低く払う。ガードできず、当たると転ぶ
      make: (w) => ({ su: w.startup + 2, act: 8, rec: R(w.recovery * 1.3), pow: w.power * 0.9, kb: 0.5, low: true, knock: 45 }),
      pose: (ph, p) => ph === 0 ? { ang: 0.3, ext: 0.3 } : ph === 1 ? { ang: 0.75, ext: 1.1 } : { ang: 0.75 - 0.5 * p, ext: 0.7 },
    },
    dash: {      // ダッシュ攻撃：一気に詰めて突く
      make: (w) => ({ su: 16, act: 8, rec: R(w.recovery * 1.4), pow: w.power * 1.4, kb: 1.3, dash: 3.2 }),
      pose: (ph, p) => ph === 0 ? { ang: -0.1, ext: 0.2 } : ph === 1 ? { ang: 0, ext: 1.25, far: 0.15 } : { ang: -0.4 * p, ext: 0.8 },
    },
    spin: {      // フルスイング：溜めてから1回転
      make: (w) => ({ su: R(w.strongStartup * 1.1), act: 16, rec: R(w.recovery * 2), pow: w.strongPower * 1.25, kb: 1.8, launch: 0.6, label: 'フルスイング!' }),
      pose: (ph, p) => ph === 0 ? { ang: -1.6 - 0.9 * p, ext: 0.8 } : ph === 1 ? { ang: -2.5 + TAU * p, ext: 1 } : { ang: -2.5 + 0.8 * p, ext: 0.8 },
    },
    // ---- 字の形で決まる得意技 ----
    slash: {     // 横薙ぎ（横長の字）：範囲が広い
      make: (w) => ({ su: R(w.strongStartup * 0.9), act: 10, rec: R(w.recovery * 1.4), pow: w.strongPower * 1.15, kb: 1.6, hitR: 1.45, label: '横薙ぎ!' }),
      pose: (ph, p) => ph === 0 ? { ang: -0.2, ext: 0.2, spin: -1.3 } : ph === 1 ? { ang: 0.1, ext: 0.4 + 0.8 * p, spin: -1.3 + 2.6 * p } : { ang: 0.1, ext: 1.2 - 0.5 * p, spin: 1.3 * (1 - p) },
    },
    thrust: {    // 突き（縦長の字）：リーチが長い
      make: (w) => ({ su: R(w.startup * 1.3) + 4, act: 9, rec: R(w.recovery * 1.3), pow: w.strongPower * 0.95, kb: 1.3, label: '突き!' }),
      pose: (ph, p) => ph === 0 ? { ang: 0, ext: 0, spin: Math.PI / 2 } : ph === 1 ? { ang: 0, ext: 1.6, far: 0.45, spin: Math.PI / 2 } : { ang: 0, ext: 1.6 - 1.0 * p, far: 0.45 * (1 - p), spin: Math.PI / 2 * (1 - p) },
    },
    smash: {     // 叩きつけ（詰まった字）：地面が割れて揺れる
      make: (w) => ({ su: R(w.strongStartup * 1.05), act: 8, rec: R(w.recovery * 1.7), pow: w.strongPower * 1.2, kb: 1, knock: 55, quake: true, label: '叩きつけ!' }),
      pose: (ph, p) => ph === 0 ? { ang: -2.5, ext: 0.9 } : ph === 1 ? { ang: -2.5 + 3.6 * p, ext: 1.05 } : { ang: 1.1, ext: 1 },
    },
  };
  // 得意技は少し強い
  function makeAttack(f, name) {
    const w = f.weapon, a = { name, type: name, t: 0, charge: 0, hit: false, ...MOVES[name].make(w) };
    if (w.signature === name) { a.pow *= 1.15; a.signature = true; }
    if (f.slowT > 0) { a.su *= 1.5; a.rec *= 1.3; }              // 鈍：動きが遅い
    if (f.howled) { a.su *= 0.7; a.rec *= 0.7; }                 // 狼：遠吠えのあと速い
    if (f.frenzy) { const k = Math.pow(0.85, f.frenzy); a.su *= k; a.rec *= k; }   // 獣：興奮するほど速い
    if (w.effect === 'dive' && name === 'jump') { a.pow *= 1.6; a.label = '急降下!'; }
    if (w.effect === 'iai' && name === 'weak') a.label = '居合!';
    if (w.effect === 'flop') a.hitR = (a.hitR || 1) * 1.25;       // 魚：暴れるので当たり判定が大きい
    if (w.stretch) { a.act += 5; if (!a.label) a.label = w.effect === 'slurp' ? 'ズルズル!' : 'ビヨーン!'; }   // 伸：伸びている時間を長く、毎回わかるように
    a.su = Math.max(2, R(a.su)); a.rec = Math.max(4, R(a.rec));
    return a;
  }
  let cracks = [];   // 叩きつけで割れた地面

  class Fighter {
    constructor(side, weapon) {
      this.side = side; this.weapon = weapon;
      this.color = side === 0 ? '#e8604c' : '#4c7be8';
      this.face = side === 0 ? '(｀・ω・´)' : '(・`ω´・)';
      this.reset();
    }
    get fx() { return this.weapon.effect; }
    reset() {
      this.x = this.side === 0 ? W * 0.27 : W * 0.73; this.y = GROUND;
      this.vx = 0; this.vy = 0; this.onGround = true;
      this.facing = this.side === 0 ? 1 : -1;
      this.hp = 100; this.crouch = false; this.guarding = false;
      this.atk = null; this.prev = NO_INPUT; this.lastHitBy = null;
      for (const s of STATUS) this[s] = 0;
      this.timers = []; this.stack = 1; this.trapT = 0; this.spicyDir = 1;
      this.trail = [];
      this.drunkFlip = false; this.confusedInp = NO_INPUT; this.t = 0;
      // 勝因を出すための記録
      this.st = { dealt: 0, direct: 0, hits: 0, best: 0, procs: 0, naps: 0, misses: 0, kyo: 0 };
      // 追加の字で使う数
      this.grass = 0; this.stings = 0; this.splits = 0; this.gloom = 0; this.sighT = 0; this.sighCd = 0; this.oshi = 1;
      this.frenzy = 0; this.lawN = 0; this.stompT = 0; this.dashAt = -999;
      this.dust = 0;                       // 負けたあと砂になって消えていく進み具合
      this.sp = 0; this.spUsed = 0;        // 必殺ゲージ（0〜100）と使った回数
      this.sinkDepth = 0;                  // 砂の必殺技で砂に沈んでいる深さ（見た目だけ）
      this.revived = false; this.howled = false; this.boundKind = ''; this.curseBy = null; this.snoozing = false;
    }
    later(frames, fn) { this.timers.push({ t: frames, fn }); }
    busy() {
      return this.frozen > 0 || this.stunned > 0 || this.hitstun > 0 || this.sleep > 0 || this.laugh > 0 || this.timestop > 0 || this.nap > 0
        || this.down > 0 || this.backT > 0 || this.snow > 0 || this.bound > 0 || this.swoon > 0;
    }
    // 転んでいる間・起き上がり直後・透明の間は攻撃が当たらない
    untouchable() { return this.down > 0 || this.wake > 0 || this.invis > 0; }
    // 歩く速さ（状態や字の効果で変わる）
    moveSpeed() {
      let v = this.weapon.move;
      if (this.spicy > 0) v *= 1.6;
      if (this.slowT > 0) v *= 0.5;
      if (this.sticky > 0) v *= 0.35;
      if (this.inSwamp > 0) v *= 0.3;
      if (this.howled) v *= 1.5;
      return v;
    }
    canJump() { return this.fx !== 'fly' && this.sticky <= 0 && this.inSwamp <= 0; }
    hurtbox() {
      const h = this.down > 0 ? 50 : this.crouch ? 80 : 140;
      return { x: this.x - 28, y: this.y - h, w: 56, h };
    }
    shoulder() { return { x: this.x + this.facing * 12, y: this.y - (this.crouch ? 70 : 89) }; }

    // 武器の向き(ang: 0=前, 負=上)と伸び(ext)
    pose() {
      const a = this.atk;
      // 構え：漢字を頭の上にまっすぐ立てて掲げる（体と重ならず、字が読める）
      if (!a) return this.guarding ? { ang: -1.5708, ext: 1.3, far: 0.2 } : { ang: -1.5708 + Math.sin(this.t * 0.05) * 0.06, ext: 1.6, far: 0.25 };
      const ph = a.t < a.su ? 0 : a.t < a.su + a.act ? 1 : 2;
      const p = ph === 0 ? a.t / a.su : ph === 1 ? (a.t - a.su) / Math.max(1, a.act - 1) : (a.t - a.su - a.act) / a.rec;
      return MOVES[a.name].pose(ph, Math.min(1, p));
    }
    weaponGeom() {
      const s = this.shoulder(), ps = this.pose(), { ang, ext } = ps;
      const dx = Math.cos(ang) * this.facing, dy = Math.sin(ang);
      const w = this.weapon;
      const far = (ps.far || 0) + (w.far || 0) + (w.stretch || 0) * this.stretchAmt();   // 槍はいつも、伸は攻撃中だけ前へ伸びる
      const ws = w.size * (this.giant || 1);                      // 必殺技で巨大化しているとき
      const d = ARM * ext + ws * (0.5 + far);
      const hitR = this.atk && this.atk.hitR ? this.atk.hitR : 1;
      return { hx: s.x + dx * ARM * ext, hy: s.y + dy * ARM * ext, cx: s.x + dx * d, cy: s.y + dy * d,
               r: ws * 0.42 * hitR, rot: Math.atan2(dy, dx) + Math.PI / 2 + (ps.spin || 0) * this.facing };
    }
    reach() { return 10 + ARM + this.weapon.size * 0.9; }
    // 伸：どれだけ伸びているか（0〜1）。出だしの終わりに一気に伸び、スキの間にゆっくり縮む
    stretchAmt() {
      const a = this.atk;
      if (!this.weapon.stretch || !a) return 0;
      if (a.t < a.su) return Math.max(0, 1 - (a.su - a.t) / 3);
      if (a.t < a.su + a.act) return 1;
      return Math.max(0, 1 - (a.t - a.su - a.act) / 14);
    }

    // 状態異常で入力を書き換える
    filterInput(inp) {
      if (this.spicy > 0) {
        if (this.x < 70) this.spicyDir = 1; else if (this.x > W - 70) this.spicyDir = -1;
        return { ...NO_INPUT, [this.spicyDir > 0 ? 'right' : 'left']: true };
      }
      if (this.confused > 0) {
        if (this.t % 20 === 0) {
          const keys = ['left', 'right', 'up', 'down', 'weak', 'guard'];
          this.confusedInp = { ...NO_INPUT, [keys[Math.floor(Math.random() * keys.length)]]: true };
        }
        inp = this.confusedInp;
      }
      if (this.fx === 'drunk') {
        if (this.t % 45 === 0) this.drunkFlip = Math.random() < 0.4;
        if (this.drunkFlip) inp = { ...inp, left: inp.right, right: inp.left };
        if (this.t % 150 === 0) popText(this.x, this.y - 170, 'ヒック', '#b06', 22);
      }
      if (this.stink > 0) inp = { ...inp, left: inp.right, right: inp.left };   // 屁：くさくて混乱し、左右が逆になる
      if (this.charm > 0) inp = { ...inp, weak: false, strong: false, move: null };
      return inp;
    }

    update(inp, opp) {
      if (this.dust) { this.physics(); return; }   // 負けて砂になっている間は動かない
      this.t++;
      // 予約していた追撃など
      if (this.timers.length) {
        const due = [];
        this.timers = this.timers.filter((tm) => (--tm.t > 0 ? true : (due.push(tm), false)));
        for (const tm of due) tm.fn();
      }
      // 継続ダメージ
      if (this.burn > 0) {
        if (this.burn % 26 === 0) this.damage(1, this.burnBy || '炎');
        if (Math.random() < 0.5) spark(this.x + rand(-20, 20), this.y - Math.random() * 120, '#ff8a1f', 1, 1.5);
      }
      if (this.poison > 0) {
        if (this.poison % 25 === 0) this.damage(1, this.bugs > 0 ? '虫' : '毒');
        if (this.bugs > 0) { if (Math.random() < 0.4) spark(this.x + rand(-26, 26), this.y - Math.random() * 140, '#222', 1, 1.5, { g: 0 }); }
        else if (Math.random() < 0.3) spark(this.x + rand(-20, 20), this.y - Math.random() * 130, '#9b4dca', 1, 1, { g: -0.05 });
      }
      if (this.tax > 0) {                                         // 税：課税されている間、HPがじわじわ減る
        if (this.tax % 25 === 0) this.damage(1, '税');
        if (this.tax % 20 === 0) spark(this.x + rand(-22, 22), this.y - rand(30, 140), '#2a8a4a', 1, 1, { vy: -1.2, g: -0.03, ch: '¥' });
      }
      if (this.bleed > 0) {
        if (this.bleed % 30 === 0) this.damage(1, this.bleedBy || '謎');
        if (Math.random() < 0.15) spark(this.x + rand(-15, 15), this.y - 90, '#c0392b', 1, 0.5);
      }
      if (this.curse > 0 && this.curse % 40 === 0) {             // 呪：吸い取ったぶん相手が回復
        this.damage(1, '呪');
        if (this.curseBy) this.curseBy.hp = Math.min(100, this.curseBy.hp + 1);
        spark(this.x, this.y - 120, '#5b2a86', 2, 1, { g: -0.05 });
      }
      if (this.sinkDepth > 0 && !(this.bound > 0)) this.sinkDepth = 0;   // 砂の必殺技が途中で終わっても、沈んだままにしない
      if (this.fx === 'regen' && this.t % 300 === 0 && this.hp > 0) this.hp = Math.min(100, this.hp + 1);   // 癒
      if (this.snoozing && this.nap > 0) this.hp = Math.min(100, this.hp + 0.25);                          // 寝
      if (this.down === 1) { this.wake = 20; popText(this.x, this.y - 150, 'よいしょ', '#777', 18); }
      if (this.nap === 1) this.snoozing = false;
      for (const s of STATUS) if (this[s] > 0) this[s]--;
      if (this.dizzy > 0 && this.t % 10 === 0) spark(this.x, this.y - 165, '#e0b000', 1, 1.5, { g: 0, ch: '★' });
      if (this.stink > 0 && this.t % 12 === 0) spark(this.x + rand(-20, 20), this.y - 150, '#8a9a2a', 1, 0.6, { vy: -1.2, g: -0.02, ch: '〜' });
      if (this.flower > 0 && this.t % 14 === 0) spark(this.x + rand(-20, 20), this.y - 150, '#ff7eb6', 1, 1, { vy: -1, g: -0.02, ch: '✿' });
      // 状態の見た目
      if (this.sleep > 0 && this.t % 25 === 0) spark(this.x + 20, this.y - 150, '#557', 1, 0.5, { vy: -1, g: -0.02, ch: 'Z' });
      if (this.charm > 0 && this.t % 18 === 0) spark(this.x, this.y - 150, '#ff5b9a', 1, 1, { vy: -1, g: -0.02, ch: '♥' });
      if (this.laugh > 0 && this.t % 30 === 0) popText(this.x, this.y - 160, 'ワハハ', '#e08a00', 24);
      if (this.spicy > 0 && this.t % 3 === 0) spark(this.x + this.spicyDir * 22, this.y - 118, '#ff4b1f', 2, 2, { vx: this.spicyDir * 3, g: 0 });

      if (this.busy()) {
        this.atk = null; this.guarding = false; this.comboNext = null; this.stompT = 0;
        if (this.onGround) this.vx *= this.snow > 0 ? 0.99 : 0.85;        // 雪だるまは転がり続ける
        this.physics(); return;
      }
      // 屁：屁をこくあいだは、相手にお尻を向けて止まる
      if (this.buttT > 0) { this.facing = opp.x >= this.x ? 1 : -1; this.vx *= 0.7; this.physics(); return; }   // 向きは相手のまま、体を半回転して描く（drawCapsuleBody）
      // 象：大ジャンプ中は、上りのあいだ相手の真上をねらい、落ちたら踏みつぶす
      if (this.stompT > 0) {
        this.stompT--;
        if (this.vy < 0) this.stompX = opp.x;
        this.vx = (this.stompX - this.x) * 0.09;
        this.physics();
        if (this.onGround) landStomp(this, opp);
        return;
      }
      // 屁・牛：一定時間、前へ突っ込む
      if (this.fartT > 0 || this.rushT > 0) {
        this.vx = this.facing * this.weapon.move * (this.rushT > 0 ? 4 : 2.6);
        if (this.fartT > 0 && this.t % 2 === 0) spark(this.x - this.facing * 26, this.y - 40, '#9aa04a', 2, 1.5, { vx: -this.facing * 2, g: -0.03 });
        if (this.rushT > 0 && this.t % 3 === 0) spark(this.x - this.facing * 20, this.y - 4, '#c9a36b', 2, 2, { g: 0 });
        // 屁：ガスに突っ込んだ相手は臭くてひるむ
        if (this.fartT > 0 && !this.fartHit && Math.abs(opp.x - this.x) < 75 && !opp.untouchable()) {
          this.fartHit = true;
          opp.damage(this.weapon.power * 0.6, this.weapon.ch); opp.stunned = Math.max(opp.stunned, 30); this.st.procs++;
          popText(opp.x, opp.y - 165, 'くさっ!', '#8a8a3a', 30);
        }
        if (this.rushT > 0 && Math.abs(opp.x - this.x) < 55 && Math.abs(opp.y - this.y) < 100 && !opp.untouchable()) {
          this.rushT = 0;
          onHit(this, opp, { name: 'rush', type: 'rush', pow: this.weapon.power * 2, kb: 1.6, knock: 30, charge: 0 }, opp.x, opp.y - 70);
        }
        this.physics(); return;
      }
      // 必殺ゲージが満タンなら必殺技（両者ともAIが自動で出す）
      if (this.sp >= 100) {
        this.spHold = (this.spHold || 0) + 1;
        if (this.t % 5 === 0) spark(this.x + rand(-30, 30), this.y - rand(20, 160), '#ffd84d', 1, 1, { vy: -1.5, g: -0.04 });   // 満タンの間は金色の粒
        const open = bigOpening(opp) && Math.random() < 0.1;                         // 隙に気づいたら撃つ
        const impatient = this.spHold > 90 && Math.random() < 0.015;                   // 1.5秒以上待つと、ときどき無理に撃つ
        const desperate = this.hp < 20 && this.spHold > 20;                             // HPが少ないと焦って撃つ
        if (canSuper(this, opp) && !this.charm && (open || impatient || desperate)) { startSuper(this, opp); this.physics(); return; }
      }
      inp = this.filterInput(inp);
      const prev = this.prev;
      const pressed = (k) => inp[k] && !prev[k];
      this.prev = inp;

      if (!this.atk) this.facing = opp.x >= this.x ? 1 : -1;
      this.guarding = inp.guard && this.onGround && !this.atk;
      this.crouch = inp.down && this.onGround && !this.atk && !this.guarding && this.fx !== 'fly';

      if (!this.atk && !this.guarding && !this.crouch) {
        const target = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * this.moveSpeed();
        // 水：濡れていると氷の上のように滑る
        this.vx = this.slip > 0 && this.onGround ? this.vx * 0.96 + target * 0.05 : target;
        if (pressed('up') && this.onGround && this.canJump()) { this.vy = -15; this.onGround = false; }
        if (this.fx === 'hop' && this.onGround) { this.vy = -8; this.onGround = false; }
        if (this.fx === 'lightspeed' && Math.abs(this.vx) > 3 && this.t % 2 === 0) {          // 光：動くと光の尾を引く
          for (let i = 0; i < 2; i++) particles.push({ x: this.x - sign(this.vx) * rand(10, 40) - 20, y: this.y - rand(15, 150), vx: 0, vy: 0, g: 0, life: 9, color: 'rgba(255,236,140,0.85)', r: 2, streak: true });
        }
      } else if (this.onGround) this.vx *= this.slip > 0 ? 0.97 : 0.7;

      // 出す技を決める（弱・強のボタン、またはAIが技の名前で指示）
      let want = null;
      if (pressed('weak')) want = 'weak';
      else if (pressed('strong')) want = 'strong';
      else if (inp.move && inp.moveSeq !== prev.moveSeq) want = inp.move;
      if (want === 'backstep' && !this.atk && this.onGround && this.canJump()) {
        this.backT = 14; this.vx = -this.facing * 8; this.vy = -4; this.onGround = false;
        want = null;
      }
      if (want === 'jump' && this.onGround) want = null;               // ジャンプ攻撃は空中だけ
      if (want && want !== 'jump' && !this.onGround && this.fx !== 'fly') want = null;
      if (want && !MOVES[want]) want = null;
      if (want && !this.atk && !this.guarding) {
        if (this.fx === 'cat' && Math.random() < 0.25) {          // 猫：気まぐれでサボる
          this.nap = 35; popText(this.x, this.y - 165, 'ニャー', '#a66', 24);
          this.st.naps++;
        } else {
          const w = this.weapon;
          this.atk = makeAttack(this, want);
          if (!(w.ranged && want === 'weak')) sfx('swing', w.size);
          if (w.effect === 'nag' && Math.random() < 0.6) nag(this);   // 母：振るたびに小言が飛んでいく
          if (this.atk.label) popText(this.x, this.y - 175, this.atk.label, this.atk.signature ? '#c0392b' : '#555', this.atk.signature ? 26 : 20);
          this.crouch = want === 'sweep';
        }
      }

      const a = this.atk;
      if (a) {
        // 強攻撃は溜め中（ボタン押しっぱなし）なら出だしで止まる
        if (a.chargeable && a.t === a.su - 1 && inp.strong && a.charge < 40) a.charge++;
        else a.t++;
        if (a.name === 'sweep') this.crouch = true;
        if (a.dash && a.t < a.su) {                               // ダッシュ：出だしの間に前へ突っ込む
          this.vx = this.facing * this.weapon.move * a.dash;
          if (this.t % 3 === 0) spark(this.x - this.facing * 20, this.y - 4, '#c9a36b', 1, 1.5, { g: 0 });
        }
        if (a.t === a.su && a.name === 'weak' && this.weapon.ranged) { shoot(this); a.hit = true; }
        if (a.t >= a.su && a.t < a.su + a.act && !a.hit) this.tryHit(opp);
        if (a.quake && a.t === a.su + a.act) quake(this, opp, a);
        if (a.air && this.onGround && a.t > 2) this.atk = null;          // 着地したら空中攻撃は終わり
        else if (a.t >= a.su + a.act + a.rec) {
          this.atk = null;
          if (!a.hit && opp.fx === 'punish') punishWhiff(this, opp);   // 罰：空振りした相手に小さな天罰
          // コンボの続き：すぐ次の技を出す（出だしは半分、少し踏み込む）
          if (this.comboNext && !opp.untouchable() && opp.hp > 0) {
            const nm = this.comboNext, dist = Math.abs(opp.x - this.x), reach = this.reach();
            this.facing = opp.x >= this.x ? 1 : -1;
            if (dist > reach * 0.7) this.x += this.facing * Math.min(50, dist - reach * 0.7);
            this.atk = makeAttack(this, nm); this.atk.su = Math.max(3, Math.round(this.atk.su * 0.5)); this.atk.combo = true;
            sfx('swing', this.weapon.size);
            if (this.atk.label) popText(this.x, this.y - 175, this.atk.label, this.atk.signature ? '#c0392b' : '#555', 20);
          }
          this.comboNext = null;
        }
      }
      this.physics();
    }
    physics() {
      if (this.twistCd > 0) this.twistCd--;
      if (this.fx === 'fly' && !this.twister) {                  // 飛：ずっと浮いている
        this.vy = 0; this.onGround = true;
        this.y = GROUND - 70 + Math.sin(this.t * 0.06) * 8;
        this.x += this.vx;
      } else {
        if (this.twister) this.vx = 0;                           // 竜巻の中は真上に上がって真下に落ちる
        this.vy += GRAV; this.y += this.vy; this.x += this.vx;
        if (this.y >= GROUND) {
          this.y = GROUND; this.vy = 0; this.onGround = true;
          if (this.twister) {                                    // 地面にたたきつけられる
            this.twister = 0; this.hitstun = 0;
            this.damage(6, '嵐');
            this.down = 36; this.downMax = 36;
            shake = Math.max(shake, 14);
            spark(this.x, GROUND - 6, '#c9a36b', 16, 6);
            popText(this.x, this.y - 130, 'ドサッ', '#555', 30);
            sfx('hit', 10, 1);
          }
        } else this.onGround = false;
      }
      this.x = Math.max(40, Math.min(W - 40, this.x));
      if (this.wallSlam > 0 && (this.x <= 40 || this.x >= W - 40)) {   // 屁の必殺技：吹き飛んで画面の端に激突
        this.wallSlam = 0; this.vx = -sign(this.vx) * 3; this.damage(4, '屁');
        shake = Math.max(shake, 22); hitstop = Math.max(hitstop, 6); sfx('boom');
        spark(this.x, this.y - 80, '#c9a36b', 26, 8); addFx('ring', this.x, this.y - 80, { color: '#ffffff', life: 18, big: true });
        popText(this.x + (this.x < W / 2 ? 60 : -60), this.y - 170, L('ドーン!!', 'SLAM!!'), '#6b4a2b', 40);
      }
    }
    tryHit(opp) {
      if (opp.untouchable() || this.thrown) return;   // 武器を投げている間は殴れない
      const g = this.weaponGeom(), hb = opp.hurtbox(), w = this.weapon;
      // 槍・矛・伸・麺のように長く突き出す技は、先だけでなく柄（手元から先まで）にも当たる。近すぎて空振りしないように
      const long = w.far || w.stretch || this.atk.name === 'thrust';
      let nx, ny, ok = false;
      for (const t of long ? [1, 0.75, 0.5] : [1]) {
        const px = g.hx + (g.cx - g.hx) * t, py = g.hy + (g.cy - g.hy) * t, r = t === 1 ? g.r : g.r * 0.7;
        nx = Math.max(hb.x, Math.min(px, hb.x + hb.w)); ny = Math.max(hb.y, Math.min(py, hb.y + hb.h));
        if ((px - nx) ** 2 + (py - ny) ** 2 <= r * r) { ok = true; break; }
      }
      if (!ok) return;
      this.atk.hit = true;
      if (this.blind > 0) { popText(nx, ny - 30, 'スカッ', '#999', 26); this.st.misses++; return; } // 光：目がくらんで当たらない
      onHit(this, opp, this.atk, nx, ny);
    }
    // direct: 武器で直接殴ったダメージ（それ以外は効果によるダメージとして記録）
    damage(n, by, direct) {
      if (n <= 0 || this.hp <= 0) return;
      if (this.mu > 0) return;                                   // 無：無の境地の間はダメージを受けない
      n *= DMG * (this.weapon.armor || 1);                       // 全体の倍率、鋼・岩・鎧
      n /= this.tough || 1;                                      // 勝ち抜きの相手は、勝ち進むほど打たれ強い
      if (this.fx === 'revive' && !this.revived && n >= this.hp) {   // 骨：1回だけHP1で起き上がる
        this.revived = true;
        n = this.hp - 1;
        this.down = 40; this.downMax = 40; this.atk = null;
        popText(this.x, this.y - 170, '蘇った!', '#3cbf5a', 30); burst(this.x, this.y - 80, '#a8f0b8', 18, 5, '✚', -0.05);
      }
      n = Math.min(n, this.hp);
      this.hp -= n;
      if (direct && this.gloom > 0 && this.hp > 0) sighOut(this);   // 鬱でやる気をなくした側は、殴られるとため息をつく
      this.lastHitBy = by;
      if (match) match.lastDmg = match.frame;     // こう着を見つけるため
      const o = match && (match.p === this ? match.c : match.p);
      if (o) { o.st.dealt += n; if (direct) o.st.direct += n; gainSp(this, n * 1.7); }
    }
  }

  // ---------- 飛び道具（弓・竜・砲）----------
  function shoot(f) {
    const w = f.weapon, g = f.weaponGeom(), dir = f.facing;
    sfx(w.effect === 'cannon' ? 'boom' : 'shoot');
    if (w.effect === 'arrow') {
      projectiles.push({ owner: f, kind: 'arrow', x: g.cx, y: f.y - 100, vx: dir * 13, vy: 0, grav: 0, r: 10, dmg: w.power, life: 120 });
      popText(f.x, f.y - 165, 'ヒュン', '#555', 20);
    } else if (w.effect === 'breath') {
      for (let i = 0; i < 3; i++) {
        projectiles.push({ owner: f, kind: "fire", x: f.x + dir * 30, y: f.y - 115, vx: dir * rand(5.5, 7.5), vy: rand(-0.8, 0.8), grav: 0, r: 14, dmg: w.power * 0.18, life: 30 });
      }
      popText(f.x, f.y - 170, 'ゴォー', '#e40', 24);
    } else if (w.effect === 'cannon') {
      projectiles.push({ owner: f, kind: 'ball', x: g.cx, y: f.y - 110, vx: dir * 8.5, vy: -6, grav: 0.25, r: 16, dmg: w.power * 1.0, life: 200 });
      shake = Math.max(shake, 6);
      popText(f.x, f.y - 170, 'ドーン', '#333', 30);
    } else if (w.effect === 'breath3') {                       // 龘：竜の3倍
      for (let i = 0; i < 9; i++) {
        projectiles.push({ owner: f, kind: 'fire', x: f.x + dir * 30, y: f.y - 115 + rand(-30, 30), vx: dir * rand(5, 8.5), vy: rand(-1.2, 1.2), grav: 0, r: 16, dmg: w.power * 0.17, life: 34 });
      }
      shake = Math.max(shake, 8);
      popText(f.x, f.y - 170, 'ゴォォォー!!', '#e40', 30);
    } else if (w.effect === 'gun') {                           // 銃：3連射
      for (const t of [0, 6, 12]) f.later(t + 1, () => {
        projectiles.push({ owner: f, kind: 'bullet', x: f.x + f.facing * 40, y: f.y - 100, vx: f.facing * 15, vy: 0, grav: 0, r: 8, dmg: w.power * 0.25, life: 80 });
        sfx('shoot');
      });
      popText(f.x, f.y - 165, 'バババン', '#333', 22);
    } else if (w.effect === 'shuriken') {                      // 忍：手裏剣
      projectiles.push({ owner: f, kind: 'shuriken', x: g.cx, y: f.y - 100, vx: dir * 11, vy: 0, grav: 0, r: 12, dmg: w.power * 0.6, life: 110 });
      popText(f.x, f.y - 165, 'シュッ', '#334', 20);
    } else if (w.effect === 'boomerang') {                     // 卍：持っている卍そのものを投げる。戻ってくるまで手ぶら
      if (f.thrown) return;
      f.thrown = { owner: f, kind: 'boomer', x: g.cx, y: f.y - 100, vx: dir * 14, ax: -dir * 0.45, vy: 0, grav: 0, r: w.size * 0.45, size: w.size, dmg: w.power * 1.0, life: 110, hits: 0, cool: 0 };
      projectiles.push(f.thrown);
      popText(f.x, f.y - 165, 'シュルル', '#c0392b', 20);
    } else if (w.effect === 'love') {                          // 恋：ハートを投げる
      projectiles.push({ owner: f, kind: 'heart', x: g.cx, y: f.y - 110, vx: dir * 7, vy: -3, grav: 0.12, r: 15, dmg: w.power * 0.4, life: 120 });
      popText(f.x, f.y - 165, 'えいっ♡', '#ff3d8a', 20);
    }
  }
  // 母：小言の文字が飛んでいく
  const NAG_WORDS = L(['ご飯よー!', '早く寝なさい!', '宿題やったの?', '片付けなさい!', 'いつまでゲームしてるの!', '歯みがいた?'],
    ['Dinner time!', 'Go to bed!', 'Did you do your homework?', 'Clean your room!', 'Enough video games!', 'Brushed your teeth?']);
  function nag(f) {
    const text = NAG_WORDS[Math.floor(Math.random() * NAG_WORDS.length)];
    projectiles.push({ owner: f, kind: 'word', text, x: f.x + f.facing * 40, y: f.y - 150, vx: f.facing * 7, vy: 0, grav: 0, r: 22, dmg: f.weapon.power * 0.3, life: 90 });
  }
  // 鮨：「へいお待ち!」と寿司を投げる（ネタはいろいろ）
  const SUSHI_NETA = ['tuna', 'salmon', 'squid', 'egg', 'shrimp'];
  function throwSushi(f) {
    const dir = f.facing;
    projectiles.push({ owner: f, kind: 'sushi', neta: SUSHI_NETA[Math.floor(Math.random() * SUSHI_NETA.length)], x: f.x + dir * 40, y: f.y - 120, vx: dir * 9, vy: -4, grav: 0.16, r: 18, dmg: f.weapon.power * 0.7, life: 110 });
    popText(f.x, f.y - 175, L('へいお待ち!', 'HERE YOU GO!'), '#c0392b', 24);
  }
  // 岩：放物線を描いて岩を投げる（地面に落ちると砕ける）
  function throwRock(f) {
    const dir = f.facing;
    projectiles.push({ owner: f, kind: 'rock', x: f.x + dir * 30, y: f.y - 150, vx: dir * 8, vy: -7, grav: 0.32, r: 22, dmg: f.weapon.power * 1.2, life: 120, seed: Math.random() * 10, spin: dir * 0.15 });
    popText(f.x, f.y - 180, L('どりゃっ', 'HEAVE!'), '#6b5a4a', 22); sfx('swing', 120);
  }
  // 蹴：持っている字をボールのように蹴って飛ばす。戻るまで手ぶら
  const KICK_LEN = 24;                      // 蹴りのポーズの長さ（フレーム）。3割で構え、そこから蹴り出す
  function kickGlyph(f) {
    if (f.thrown || f.kickT > 0) return;
    const w = f.weapon;
    f.kickT = KICK_LEN; f.thrownSuper = 8;                     // 字を足もとへ落として構える
    f.later(8, () => {                                        // 足を振り抜いた瞬間に飛ばす
      if (f.thrown || f.hp <= 0) return;
      f.thrown = { owner: f, kind: 'kickball', x: f.x + f.facing * 46, y: f.y - 46, vx: f.facing * 15, vy: -5, grav: 0.12, r: Math.max(24, w.size * 0.35), size: Math.min(110, w.size * 0.8), dmg: w.power * 1.1, life: 70 };
      projectiles.push(f.thrown);
      addFx('crescent', f.x + f.facing * 40, f.y - 50, { life: 10, dir: f.facing, size: 0.9, rot: -0.6 * f.facing, color: '#ffe680' });
      spark(f.x + f.facing * 46, f.y - 46, '#ffd84d', 10, 5);
      sfx('swing', w.size); popText(f.x, f.y - 170, L('シュート!', 'SHOOT!'), '#c0392b', 26);
    });
  }
  // 魂：体のまわりを回る3つの人魂の位置
  function soulOrbs(f) {
    const out = [];
    for (let k = 0; k < 3; k++) { const a = f.t * 0.06 + k * TAU / 3; out.push({ x: f.x + Math.cos(a) * 64, y: f.y - 95 + Math.sin(a) * 48, front: Math.sin(a) > 0, a }); }
    return out;
  }
  // 罰：相手が空振りしたら、その頭上に小さな天罰の雷（続けては落ちない）
  function punishWhiff(att, judge) {
    if (judge.hp <= 0 || att.hp <= 0 || att.untouchable() || Math.abs(att.x - judge.x) > att.reach() + 80) return;
    if (judge.t - (judge.punishAt || -999) < 70) return;
    judge.punishAt = judge.t;
    addFx('bolt', att.x, att.y - 90, { life: 12 }); sfx('zap');
    att.damage(judge.weapon.power * 0.45, judge.weapon.ch); att.stunned = Math.max(att.stunned, 18); att.hitFlash = 4;
    popText(att.x, att.y - 175, L('天罰!', 'KARMA!'), '#c9a000', 26); judge.st.procs++;
  }
  function updateProjectiles(m) {
    for (const p of projectiles) {
      p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.life--;
      if (p.ax) p.vx += p.ax;
      if (p.cool > 0) p.cool--;
      if (p.kind === 'fire' && Math.random() < 0.6) spark(p.x, p.y, '#ff9a1f', 1, 1, { g: -0.05 });
      if (p.kind === 'wave' && Math.random() < 0.7) spark(p.x + rand(-20, 20), GROUND - rand(0, 50), '#5aa0e0', 1, 2, { g: 0.1 });
      if (p.kind === 'rock' && p.y >= GROUND - 14) { p.life = 0; spark(p.x, GROUND - 8, '#8a7a6a', 14, 5); shake = Math.max(shake, 5); continue; }   // 岩は地面で砕ける
      if (p.kind === 'bouncer') {                                   // 球：壁と地面ではね返る
        if (p.x < 34 || p.x > W - 34) { p.x = Math.max(34, Math.min(W - 34, p.x)); p.vx = -p.vx * 0.92; spark(p.x, p.y, '#ffffff', 6, 3); sfx('hit', 3, 30); }
        if (p.y >= GROUND - 14) { p.y = GROUND - 14; p.vy = -Math.max(5, Math.abs(p.vy) * 0.72); }
      }
      if ((p.kind === 'sushi' || p.kind === 'kickball') && p.y >= GROUND - 10) { p.y = GROUND - 10; p.vy = -Math.abs(p.vy) * 0.5; p.vx *= 0.8; }   // 地面で弾む
      // 卍：持ち主の所まで戻ってきたら消える
      if (p.kind === 'boomer' && sign(p.vx) === sign(p.ax)) {     // 速さの向きが引き戻す向きと同じ＝帰り道
        // 帰り道：持ち主の高さへ寄っていき、持ち主の所まで来たら（通り過ぎていても）必ず受け取る
        const o = p.owner, back = sign(p.ax);
        p.y += (o.y - 100 - p.y) * 0.15;
        if ((p.x - o.x) * back >= -40 || p.life <= 1) { p.life = 0; popText(o.x, o.y - 175, L('パシッ', 'CATCH'), '#555', 20); continue; }
      }
      const t = p.owner === m.p ? m.c : m.p, hb = t.hurtbox();
      if (t.untouchable() || p.cool > 0) { if ((p.x < -40 || p.x > W + 40) && p.kind !== 'boomer') p.life = 0; continue; }
      const nx = Math.max(hb.x, Math.min(p.x, hb.x + hb.w)), ny = Math.max(hb.y, Math.min(p.y, hb.y + hb.h));
      if ((p.x - nx) ** 2 + (p.y - ny) ** 2 <= p.r * p.r) {
        if (t.fx === 'iai' && p.kind !== 'wave' && !t.busy() && Math.random() < 0.45) {   // 侍：飛び道具を斬り落とす
          p.life = 0; t.st.procs++;
          addFx('crescent', p.x, p.y, { life: 12, dir: -sign(p.vx) || 1, size: 0.8, rot: rand(-0.5, 0.5) });
          popText(t.x, t.y - 165, L('斬!', 'SLICE!'), '#c00', 28); sfx('slash');
          continue;
        }
        if (t.fx === 'mirror' && !p.reflected && Math.random() < 0.4) {                                       // 鏡：跳ね返す
          p.reflected = true; p.owner = t; p.vx = -p.vx; if (p.ax) p.ax = -p.ax;
          addFx('crack', p.x, p.y, { life: 30, seed: Math.random() * 6 }); popText(t.x, t.y - 160, 'キラン', '#3aa0c0', 28); sfx('guard');
          continue;
        }
        if (p.kind === 'boomer') p.cool = ++p.hits < 2 ? 25 : 9999;                   // 卍は行きと帰りで2回まで当たる。当たっても消えずに持ち主の手元へ戻る
        else if (p.kind === 'bouncer') { p.vx = -p.vx * 0.85; p.vy = -7; p.cool = 30; if (++p.hits >= 3) p.life = Math.min(p.life, 20); }   // 球：相手に当たってもはね返る（3回まで）
        else p.life = 0;
        onHit(p.owner, t, { type: p.kind === 'ball' || p.kind === 'kickball' || p.kind === 'rock' ? 'strong' : 'weak', power: p.dmg, charge: 0, proj: p.kind, kb: p.kind === 'bullet' ? 0.25 : undefined }, nx, ny);
      } else if (p.kind === 'ball' && p.y >= GROUND) {
        p.life = 0;
        spark(p.x, GROUND, '#777', 20, 6); shake = Math.max(shake, 8);
      }
      if ((p.x < -40 || p.x > W + 40) && p.kind !== 'boomer') p.life = 0;   // 卍は画面の外まで飛んでも戻ってくる
    }
    projectiles = projectiles.filter((p) => p.life > 0);
    for (const f of [m.p, m.c]) if (f.thrown && !projectiles.includes(f.thrown)) f.thrown = null;   // 戻ってきたら（消えたら）また手に持つ
  }

  // 屁：においの雲（相手のほうへ流れていき、ふれた相手は混乱して左右が逆になる）
  let stinks = [];
  function fart(f, o) {
    f.buttT = 26; f.vx = 0;                                       // くるっと後ろを向いて、お尻を相手に向ける
    f.later(9, () => {
      if (f.hp <= 0) return;
      const d = o.x >= f.x ? 1 : -1;
      stinks.push({ x: f.x + d * 20, y: f.y - 60, vx: d * 6, owner: f, life: 170, hit: false });
      popText(f.x + d * 30, f.y - 80, L('プゥ〜', 'PFFT~'), '#8a8a3a', 28); sfx('swing', 20);
      for (let i = 0; i < 10; i++) spark(f.x + d * 20, f.y - 55, '#9aa04a', 1, 2, { vx: d * rand(1, 4), g: -0.03 });
    });
  }
  function updateStinks(m) {
    for (const s of stinks) {
      s.x += s.vx; s.vx *= 0.97; s.life--;
      const v = s.owner === m.p ? m.c : m.p;
      if (!s.hit && v.hp > 0 && !v.untouchable() && Math.abs(v.x - s.x) < 75) {
        s.hit = true; v.stink = 170; v.stunned = Math.max(v.stunned, 20); v.damage(s.owner.weapon.power * 0.75, s.owner.weapon.ch); s.owner.st.procs++;
        popText(v.x, v.y - 170, L('くさっ!!', 'STINKY!!'), '#8a8a3a', 32);
      }
    }
    stinks = stinks.filter((s) => s.life > 0);
  }
  function drawStinks() {
    for (const s of stinks) {
      ctx.save(); ctx.globalAlpha = Math.min(1, s.life / 40) * 0.75;
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1 + s.life * 0.03, r = 26 + (i % 3) * 9;
        ctx.fillStyle = i % 2 ? 'rgba(170,180,70,0.45)' : 'rgba(140,155,50,0.4)';
        ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * 30, s.y + Math.sin(a) * 22, r, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(110,120,30,0.8)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k++) {                              // くさいにおいの線
        ctx.beginPath();
        for (let j = 0; j <= 8; j++) { const y = s.y - 40 - j * 6, x = s.x + k * 22 + Math.sin(j * 0.9 + s.life * 0.2 + k) * 6; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // 象：大ジャンプから着地。真下にいる相手を踏みつぶす
  function landStomp(f, o) {
    f.stompT = 0;
    shake = Math.max(shake, 18); sfx('boom');
    spark(f.x, GROUND - 6, '#c9a36b', 24, 7); cracks.push({ x: f.x, life: 90, seed: Math.random() * 1000 });
    popText(f.x, f.y - 190, L('ドスーン!!', 'KA-THOOM!!'), '#6b4a2b', 36);
    if (Math.abs(o.x - f.x) < 75 && !o.untouchable() && o.hp > 0 && o.fx !== 'fly') {
      onHit(f, o, { name: 'stomp', type: 'strong', pow: f.weapon.power * 1.8, kb: 0.4, charge: 0 }, o.x, o.y - 40);
      if (o.hp > 0) { o.down = 40; o.downMax = 40; o.atk = null; }
      f.st.procs++;
    }
  }
  // 球：球を投げる
  function throwBall(f) {
    const w = f.weapon;
    projectiles.push({ owner: f, kind: 'bouncer', x: f.x + f.facing * 34, y: f.y - 115, vx: f.facing * 13, vy: -3, grav: 0.3, r: 15, dmg: w.power * 0.55, life: 240, hits: 0 });
    popText(f.x, f.y - 180, L('投げた!', 'PITCH!'), '#555', 22); sfx('swing', w.size);
  }
  // 滅：「〇〇すぎて滅！」
  const DOOM_JA = ['強すぎて', '尊すぎて', '眠すぎて', '速すぎて', '好きすぎて', 'お腹すきすぎて', '暑すぎて', '寒すぎて', '月曜日すぎて', '推しが尊すぎて'];
  const DOOM_EN = ['Too strong', 'Too precious', 'Too sleepy', 'Too fast', 'Too hungry', 'Too hot', 'Too cold', 'Too Monday', 'Too much love'];
  const doomLine = () => L(DOOM_JA[Math.floor(Math.random() * DOOM_JA.length)] + '滅!', DOOM_EN[Math.floor(Math.random() * DOOM_EN.length)] + '. DOOM!');
  // 法：読み上げる罪状
  const LAW_CRIMES = ['暴行罪!', '傷害罪!', '器物損壊罪!', '公務執行妨害!', '威力業務妨害!'];
  const LAW_CRIMES_EN = ['ASSAULT!', 'BATTERY!', 'VANDALISM!', 'OBSTRUCTION!', 'DISTURBING THE PEACE!'];

  // ---------- 一定時間ごとに起きる効果（f が字の持ち主、o が相手）----------
  let swamps = [];
  function periodic(m, f, o) {
    const fx = f.fx, w = f.weapon, every = (n) => f.t > 60 && f.t % n === 0;
    const dist = Math.abs(o.x - f.x), free = !f.busy() && !f.atk;
    const ok = () => !o.untouchable() && o.hp > 0;
    switch (fx) {
      case 'nothing':                                 // 無：ときどき無の境地に入る（約1.7秒）
        if (every(480) && f.mu <= 0) {
          f.mu = 100; f.st.procs++;
          popText(f.x, f.y - 180, '無の境地', '#555', 30); sfx('proc');
        }
        if (f.mu > 0) {
          // 状態異常をすべて消す
          for (const s of ['frozen', 'stunned', 'sleep', 'laugh', 'charm', 'timestop', 'spicy', 'blind', 'confused', 'burn', 'poison',
                           'bleed', 'slip', 'snow', 'bound', 'sticky', 'slowT', 'curse', 'swoon', 'dizzy', 'hitstun', 'down', 'squash', 'inSwamp', 'tax', 'bow', 'stink']) f[s] = 0;
          f.gloom = 0;
          if (f.t % 8 === 0) spark(f.x + rand(-30, 30), f.y - rand(10, 150), '#ffffff', 1, 0.6, { vy: -1, g: -0.02 });
        }
        break;
      case 'fart':                                    // 屁：くさい屁をこく。においの雲が相手のほうへ流れていく
        if (every(130) && free && dist < 330) fart(f, o);
        break;
      case 'stomp':                                   // 象：ときどき大ジャンプして、相手の真上から踏みつぶす
        if (every(150) && free && f.onGround && ok() && dist > 60 && dist < 420) {
          f.vy = -20; f.onGround = false; f.y -= 1; f.stompT = 70; f.stompX = o.x;
          popText(f.x, f.y - 180, L('パオーン!', 'PAOOO!'), '#6b4a2b', 30); sfx('swing', 90);
        }
        break;
      case 'iai':                                     // 侍：離れていると、ときどき一瞬で踏み込んで斬る
        if (f.t - f.dashAt > 150 && free && f.onGround && ok() && dist > f.reach() + 30 && dist < 560 && Math.random() < 0.02) {
          f.dashAt = f.t;
          const from = f.x, d = o.x >= f.x ? 1 : -1;
          f.x = Math.max(40, Math.min(W - 40, o.x - d * f.reach() * 0.75)); f.facing = d;
          for (let j = 0; j < 16; j++) particles.push({ x: from + (f.x - from) * Math.random(), y: f.y - rand(10, 150), vx: 0, vy: 0, g: 0, life: 14, color: 'rgba(255,255,255,0.85)', r: 2, streak: true });
          spark(f.x, f.y - 4, '#c9a36b', 12, 4);
          popText(f.x, f.y - 185, L('踏み込み!', 'DASH-IN!'), '#c00', 26);
          f.atk = makeAttack(f, 'weak'); f.atk.su = 2; f.st.procs++;
        }
        break;
      case 'lightspeed':                              // 光：ときどき光の線になって、一瞬で相手の目の前か背後へ
        if (every(160) && free && f.onGround && ok() && dist > 110 && dist < 700) {
          const from = f.x, behind = Math.random() < 0.5;
          let nx = o.x + (behind ? 1 : -1) * (o.x >= f.x ? 1 : -1) * f.reach() * 0.7;
          nx = Math.max(40, Math.min(W - 40, nx));
          f.x = nx; f.facing = o.x >= f.x ? 1 : -1;
          addFx('lightdash', from, f.y - 90, { life: 12, x2: f.x }); sfx('zap');
          popText(f.x, f.y - 185, L('ピカッ', 'FLASH!'), '#d0a000', 28);
          f.atk = makeAttack(f, 'weak'); f.atk.su = 2; f.st.procs++;
        }
        if (Math.abs(f.vx) > 2.5 && f.t % 4 === 0) { f.lightTrail = (f.lightTrail || []).concat([{ x: f.x, y: f.y, d: f.facing }]).slice(-3); }
        else if (f.t % 6 === 0 && f.lightTrail && f.lightTrail.length) f.lightTrail.shift();
        break;
      case 'pitch':                                   // 球：ときどき球を投げる（壁ではね返って何度も当たる）
        if (every(150) && free && dist > 110 && ok() && !projectiles.some((p) => p.owner === f && p.kind === 'bouncer')) throwBall(f);
        break;
      case 'rush':                                    // 牛：突進
        if (every(160) && free && f.onGround && dist > 110) { f.rushT = 40; popText(f.x, f.y - 170, 'モー!', '#6b4a2b', 30); }
        break;
      case 'god':                                     // 神：離れていても、相手の頭上に天罰を落とす
        if (every(110) && dist > 170 && ok() && !f.busy()) {
          smites.push({ x: o.x, t: 0, by: f, tgt: o });
          popText(f.x, f.y - 215, L('天罰!', 'JUDGMENT!'), '#c90', 28); sfx('gauge');
        }
        break;
      case 'quakeT':                                  // 震：地震で地面にいる相手が転ぶ
        if (every(280)) {
          shake = Math.max(shake, 16); sfx('boom');
          popText(W / 2, GROUND * 0.3, 'ゴゴゴゴ…', '#6b4a2b', 34);
          cracks.push({ x: o.x, life: 90, seed: Math.random() * 1000 });
          if (o.onGround && o.fx !== 'fly' && ok()) { o.down = 40; o.downMax = 40; o.atk = null; o.damage(3, w.ch); f.st.procs++; }
        }
        break;
      case 'wave':                                    // 波：地面を走る大波
        if (every(220)) {
          projectiles.push({ owner: f, kind: 'wave', x: f.x + f.facing * 40, y: GROUND - 30, vx: f.facing * 7, vy: 0, grav: 0, r: 34, dmg: w.power * 0.6, life: 120 });
          popText(f.x, f.y - 170, 'ザブーン', '#2a6fb0', 28);
        }
        break;
      case 'dive':                                    // 鳥：高く飛び上がる（落ちながらジャンプ攻撃）
        if (every(210) && free && f.onGround) { f.vy = -20; f.onGround = false; popText(f.x, f.y - 170, 'バサッ', '#555', 24); }
        break;
      case 'vanish':                                  // 消：透明になる
        if (every(260)) { f.invis = 55; popText(f.x, f.y - 170, 'スッ…', '#999', 24); }
        break;
      case 'snooze':                                  // 寝：寝て回復
        if (every(330) && free) { f.nap = 90; f.snoozing = true; popText(f.x, f.y - 170, 'Zzz…', '#557', 28); }
        if (f.snoozing && f.t % 25 === 0) spark(f.x + 20, f.y - 150, '#557', 1, 0.5, { vy: -1, g: -0.02, ch: 'Z' });
        break;
      case 'howl':                                    // 狼：HPが半分を切ったら遠吠え
        if (!f.howled && f.hp < 50 && f.hp > 0) { f.howled = true; popText(f.x, f.y - 175, 'アオーン!', '#555', 32); sfx('vs'); }
        break;
      case 'oshi':                                    // 推：うちわが飛んできて強くなる
        if (every(300) && f.oshi < 1.6) {
          f.oshi = Math.min(1.6, f.oshi + 0.15);
          spark(f.x, f.y - 160, '#ff5b9a', 6, 3, { ch: '♡' });
          popText(f.x, f.y - 180, '推せる!!', '#ff3d8a', 26);
        }
        break;
      case 'swamp':                                   // 沼：相手の足元に沼を作る
        if (every(150) && swamps.filter((s) => s.owner === f).length < 1) {
          swamps.push({ x: o.x, owner: f, life: 520 });
          popText(o.x, GROUND - 30, 'ズブズブ', '#6b5a2e', 24);
        }
        break;
      case 'shout':                                   // 叫：衝撃波
        if (every(200) && dist < 280 && ok()) {
          o.vx = sign(o.x - f.x) * 18; o.damage(w.power * 0.4, w.ch); o.hitstun = Math.max(o.hitstun, 15);
          spark(f.x, f.y - 100, '#ffffff', 16, 9, { g: 0 });
          addFx('rings', f.x, f.y - 100, { life: 30 }); popText(f.x, f.y - 175, 'ワーッ!!', '#d33', 34); sfx('boom'); f.st.procs++;
        }
        break;
      case 'sushi':                                   // 鮨：ときどき寿司を投げる
        if (every(150) && free && dist > 120 && ok()) throwSushi(f);
        break;
      case 'rockthrow':                               // 岩：たまに岩を投げる
        if (every(100) && free && dist > 100 && ok()) throwRock(f);
        break;
      case 'kick':                                    // 蹴：離れているとき、ときどき字を蹴って飛ばす
        if (every(170) && free && f.onGround && dist > 150 && ok()) kickGlyph(f);
        break;
      case 'ghost':                                   // 霊：ときどき体が透けて、攻撃をすり抜ける
        if (every(320)) { f.invis = 50; popText(f.x, f.y - 175, L('ヒュ〜ドロドロ', 'OooOOooo'), '#7a8aa8', 22); }
        break;
      case 'sneak':                                   // 悪：ときどき相手の背後にワープして殴る
        if (every(230) && free && f.onGround && ok() && dist < 380) {
          const from = f.x, bx = Math.max(40, Math.min(W - 40, o.x - o.facing * 60));
          if (Math.abs(bx - o.x) < 30) break;                                 // 壁ぎわで背後に回れないときはやめる
          f.x = bx; f.facing = o.x >= f.x ? 1 : -1;
          for (let j = 0; j < 14; j++) particles.push({ x: from + (f.x - from) * Math.random(), y: f.y - rand(20, 150), vx: 0, vy: 0, g: 0, life: 14, color: 'rgba(90,20,110,0.8)', r: 2, streak: true });
          burst(f.x, f.y - 80, '#3a1a4a', 14, 4, null, -0.03);
          popText(f.x, f.y - 180, L('フハハ!', 'MWAHAHA!'), '#5a1a6a', 26);
          f.atk = makeAttack(f, 'weak'); f.atk.su = 3; f.st.procs++;
        }
        break;
      case 'souls': {                                 // 魂：まわりを回る人魂が、近づいた相手に当たる
        if (f.soulCd > 0 || !ok()) break;
        for (const s of soulOrbs(f)) {
          if (Math.abs(s.x - o.x) < 34 && s.y > o.y - 150 && s.y < o.y + 10) {
            o.damage(w.power * 0.2, w.ch); o.hitstun = Math.max(o.hitstun, 6); o.hitFlash = 3;
            spark(s.x, s.y, '#7ac8ff', 10, 4); popText(o.x, o.y - 165, L('ボッ', 'FWOOSH'), '#3a7ad0', 22);
            f.soulCd = 90; f.st.procs++;
            break;
          }
        }
        break;
      }
      case 'haki':                                    // 覇：近くにいるだけで相手がひるむ
        if (dist < 140 && f.t % 110 === 0 && ok() && !o.busy()) {
          o.stunned = 14; popText(o.x, o.y - 165, 'ビクッ', '#7a2a9a', 24); f.st.procs++;
        }
        if (f.t % 6 === 0) spark(f.x + rand(-30, 30), f.y - rand(0, 140), '#7a2a9a', 1, 1, { vy: -1.5, g: 0 });
        break;
    }
  }

  // ---------- ステージ全体の効果（磁・嵐・罠・巨）----------
  function updateField(m) {
    // 神の天罰：予告の光の輪が出てから、少しして天から光の柱が落ちる（輪から逃げていれば外れる）
    for (const s of smites) {
      if (++s.t !== 40) continue;
      const o = s.tgt;
      addFx('pillar', s.x, GROUND, { color: '255,240,170', life: 26, wide: 1 });
      m.flash = Math.max(m.flash, 5); shake = Math.max(shake, 8); sfx('zap');
      if (o.hp > 0 && s.by.hp > 0 && !o.untouchable() && Math.abs(o.x - s.x) < 55) onHit(s.by, o, { type: 'strong', power: s.by.weapon.power * 0.6, charge: 0, proj: 'smite' }, o.x, o.y - 90);
      else popText(s.x, GROUND - 70, L('はずれ', 'MISS'), '#999', 22);
    }
    smites = smites.filter((s) => s.t < 60);
    const both = [[m.p, m.c], [m.c, m.p]];
    for (const [f, o] of both) {
      const fx = f.fx;
      if (fx === 'magnet' && !o.busy()) {
        const d = f.x - o.x;
        if (Math.abs(d) > 90) o.x += sign(d) * 0.7;
        if (m.frame % 10 === 0) spark(o.x, o.y - 70, '#5aa0ff', 1, 1, { vx: sign(d) * 2, g: 0 });
      }
      if (fx === 'trap' && ++f.trapT % 200 === 0 && traps.filter((t) => t.owner === f).length < 2) {
        traps.push({ x: f.x, owner: f });
        popText(f.x, f.y - 165, 'ポイッ', '#555', 20);
      }
      if (fx === 'grow' && f.weapon.size < f.weapon.baseSize * 1.6) {
        f.weapon.size += f.weapon.baseSize * 0.0007;
        f.weapon.power = f.weapon.basePower * f.weapon.size / f.weapon.baseSize;
        f.weapon.strongPower = f.weapon.power * 2;
      }
      periodic(m, f, o);
    }
    updateStinks(m);
    // 沼：はまっている間は遅く、跳べない
    for (const s of swamps) {
      s.life--;
      const v = s.owner === m.p ? m.c : m.p;
      if (v.fx !== 'fly' && v.onGround && Math.abs(v.x - s.x) < 46) {
        v.inSwamp = 2;
        if (m.frame % 20 === 0) spark(v.x + rand(-20, 20), GROUND - 4, '#6b5a2e', 1, 1, { vy: -1, g: 0.02 });
      }
    }
    swamps = swamps.filter((s) => s.life > 0);
    for (const t of traps) {
      const v = t.owner === m.p ? m.c : m.p;
      if (v.fx !== 'fly' && v.onGround && Math.abs(v.x - t.x) < 24) {
        t.used = true;
        v.stunned = 70; v.damage(4, '罠');
        spark(t.x, GROUND - 10, '#888', 15, 5);
        popText(v.x, v.y - 165, 'ガシャン', '#555', 30);
        sfx('clang'); t.owner.st.procs++;
      }
    }
    traps = traps.filter((t) => !t.used);
    if (m.flash > 0) m.flash--;
    if (m.dark > 0) m.dark--;
  }

  // ---------- 当たったとき ----------
  const LUCK = [[0, '凶…', '#557'], [0.5, '末吉', '#777'], [1, '吉', '#2a2'], [1, '吉', '#2a2'], [1.5, '中吉', '#c80'], [2, '大吉!', '#d33'], [3, '大大吉!!', '#d0a000']];
  // 叩きつけ：武器が地面に届いた瞬間、地面が割れて衝撃波が走る
  function quake(f, opp, a) {
    const g = f.weaponGeom(), gx = g.cx;
    cracks.push({ x: gx, life: 90, seed: Math.random() * 1000 });
    spark(gx, GROUND - 4, '#9b7a4a', 22, 7);
    shake = Math.max(shake, 16);
    sfx('boom');
    if (!a.hit && opp.onGround && opp.fx !== 'fly' && !opp.untouchable() && Math.abs(opp.x - gx) < 80 + f.weapon.size * 0.4) {
      a.hit = true;
      onHit(f, opp, { ...a, pow: a.pow * 0.45, kb: 0.4, signature: false }, opp.x, GROUND - 20);
    }
  }

  // 少し遅れて当たる追撃（剣・牙・爪・双・分）
  function followUp(att, def, frames, mul, text, color) {
    att.later(frames, () => {
      if (def.hp <= 0 || def.untouchable() || Math.abs(def.x - att.x) > att.reach() + 50) return;
      const n = att.weapon.power * mul;
      def.damage(n, att.weapon.ch);
      spark(def.x, def.y - 90, color, 6, 4);
      popText(def.x + rand(-20, 20), def.y - 145, text, color, 24);
      sfx('hit', n, att.weapon.size);
    });
  }

  // ---------- 字の形の特徴（どの字にも効く）----------
  // とがった字は突き刺して出血させ、かぎのある字は足を引っかけて転ばせ、平らな面のある字は面で叩いて吹き飛ばす
  const FACE_MOVES = ['strong', 'smash', 'spin', 'slash'];
  function shapeHit(att, def, a, hx, hy) {
    const tr = att.weapon.traits;
    if (!tr || a !== att.atk || def.hp <= 0) return;
    const top = def.y - 190;
    if (tr.point && (a.name === 'thrust' || a.name === 'dash' || (a.name === 'weak' && Math.random() < 0.3))) {
      def.bleed = Math.max(def.bleed || 0, 100); def.bleedBy = att.weapon.ch;
      spark(hx, hy, '#c0392b', 10, 5); popText(hx, hy - 60, L('突き刺し!', 'STAB!'), '#c0392b', 26);
    }
    if (tr.hook && def.fx !== 'fly' && (a.name === 'sweep' || (a.name === 'weak' && Math.random() < 0.2))) {
      def.vx = -att.facing * 7; def.down = Math.max(def.down || 0, 55); def.downMax = Math.max(def.downMax || 0, 55); def.hitstun = 0; def.atk = null;
      if (a.name === 'sweep') def.damage(att.weapon.power * 0.6, att.weapon.ch, true);   // 引っかけて転ばせた分の追加ダメージ
      popText(def.x, top, L('引っかけ!', 'HOOKED!'), '#7a3ab0', 28);
    }
    if (tr.flat && FACE_MOVES.includes(a.name)) {
      def.vx *= 1.4; popText(hx, hy - 60, L('面打ち!', 'FLAT SMACK!'), '#2a6fb0', 24);
    }
  }
  // ---------- コンボ ----------
  // 武器で直接当てたとき、ときどき次の技につなげる（2連・3連）。1発目から 22%、2発目から 45%
  const COMBO_NEXT = [null, ['weak', 'strong'], ['strong', 'spin']];
  function combo(att, def, a, hx, hy) {
    if (a !== att.atk || a.air || a.knock || !match || match.phase !== 'fight') return;
    const n = att.comboAt != null && match.frame - att.comboAt < 60 && a.combo ? att.comboN + 1 : 1;
    att.comboN = n; att.comboAt = match.frame;
    if (n >= 2) {
      popText(def.x, def.y - 205, n >= 3 ? L('3連コンボ!!', '3-HIT COMBO!!') : L('2連!', '2 HITS!'), n >= 3 ? '#d0a000' : '#e8604c', n >= 3 ? 36 : 30);
      if (n >= 3) { addFx('ring', hx, hy, { color: '#ffd84d', life: 16, big: true }); shake = Math.max(shake, 14); }
    }
    const nexts = COMBO_NEXT[n];
    if (!nexts || def.hp <= 0 || Math.random() > (n === 1 ? 0.22 : 0.45)) return;
    // つなぐ：今の技のスキを消し、相手をその場によろけさせておく
    att.comboNext = att.weapon.signature && n === 2 && Math.random() < 0.5 ? att.weapon.signature : nexts[Math.floor(Math.random() * nexts.length)];
    a.rec = 2;
    def.vx *= 0.3;
    def.hitstun = Math.max(def.hitstun, a.su + a.act - a.t + 26);
  }

  function onHit(att, def, a, hx, hy) {
    const w = att.weapon, m = match;
    att.grinUntil = att.t + 50;                  // 当てた側は少しのあいだニヤリ（3Dのキャラの表情）
    let mul = 1 + (a.charge / 40) * 0.6;
    if (w.effect === 'rage') mul *= 1 + (1 - att.hp / 100);
    if (w.effect === 'luck') {
      const [v, label, col] = LUCK[Math.floor(Math.random() * LUCK.length)];
      mul *= v; popText(hx, hy - 60, label, col, 34);
      if (v === 0) att.st.kyo++;
    }
    if (w.effect === 'pump' && a.type !== 'super') { mul *= att.stack; att.stack = Math.min(1.5, att.stack + 0.06); }   // 筋：当てるたびにムキムキ
    const reaped = w.effect === 'reap' && def.hp <= 30 && a.type !== 'super';                                        // 鎌：弱った相手を刈り取る
    if (reaped) mul *= 2.2;
    let crit = false;
    if (w.effect === 'crit' && Math.random() < 0.3) { mul *= 2.5; crit = true; }
    if (w.effect === 'gold') mul *= rand(0.5, 2);                  // 金：ダメージが毎回ばらつく
    mul *= att.oshi || 1;                                          // 推：応援されるほど強い
    const base = a.pow != null ? a.pow : a.power;

    // 無：無の境地の間は、攻撃も効果も受けつけない
    if (def.mu > 0) {
      spark(hx, hy, '#ffffff', 10, 4); popText(def.x, def.y - 160, '無効', '#777', 26); sfx('guard');
      hitstop = 2;
      return;
    }
    // 影：黒い影が身代わりになる
    if (def.fx === 'shadow' && a.type !== 'super' && !(def.shadowCd > 0) && def.hp > 0 && Math.random() < 0.3) {
      def.shadowCd = 90; def.st.procs++;
      addFx('shadowsub', def.x, def.y, { life: 34, f: def, d: def.facing });
      burst(def.x, def.y - 80, '#1a1a22', 18, 4, null, -0.03);
      popText(def.x, def.y - 175, L('影武者!', 'SHADOW DOUBLE!'), '#222', 28); sfx('guard');
      def.x = Math.max(40, Math.min(W - 40, def.x + att.facing * 80));
      hitstop = 4;
      return;
    }
    // 法：「異議あり!」で攻撃を打ち消す
    if (def.fx === 'law' && a.type !== 'super' && !(def.objCd > 0) && def.hp > 0 && Math.random() < 0.15) {
      def.objCd = 120; def.st.procs++;
      popText(def.x, def.y - 180, L('異議あり!', 'OBJECTION!'), '#c0392b', 36); sfx('clang');
      att.stunned = Math.max(att.stunned, 18); att.atk = null; att.vx = -att.facing * 6;
      spark(hx, hy, '#ffffff', 14, 6); addFx('ring', hx, hy, { color: '#ffffff', life: 14 });
      hitstop = 6;
      return;
    }
    // 幻：分身が攻撃を引きつける / 鏡：近接攻撃をはね返す
    if (def.fx === 'illusion' && a.type !== 'super' && Math.random() < 0.3) {
      addFx('mirage', def.x, def.y, { life: 30, f: def, d: def.facing });       // 元の場所の姿が、ゆらゆら揺れて消える
      popText(def.x, def.y - 170, L('ゆらり…', 'SHIMMER…'), '#7a5ab0', 26); def.st.procs++;
      const bx = Math.max(40, Math.min(W - 40, att.x + att.facing * 70));
      def.x = Math.abs(bx - att.x) < 30 ? Math.max(40, Math.min(W - 40, att.x - att.facing * 90)) : bx;
      def.facing = att.x >= def.x ? 1 : -1; def.vx = 0; def.hitstun = 0;
      burst(def.x, def.y - 80, '#d8ccff', 16, 3, null, -0.04);
      hitstop = 4;
      return;
    }
    if (def.fx === 'mirror' && !a.proj && Math.random() < 0.1) {
      att.damage(base * mul * 0.5, def.weapon.ch); att.hitstun = 12; att.vx = -att.facing * 6;
      addFx('crack', hx, hy, { life: 30, seed: Math.random() * 6 }); spark(hx, hy, '#bfeaff', 14, 6); popText(def.x, def.y - 160, 'キラン（反射）', '#3aa0c0', 26); sfx('guard');
      return;
    }
    const kbMul = a.kb != null ? a.kb : a.type === 'strong' ? 1.5 : 1;
    const dmg = base * mul, kb = w.knockback * kbMul * Math.min(mul, 2);

    // 足払い（下段）はガードできない
    if (def.guarding && def.facing === -att.facing && w.effect !== 'pierce' && !a.low) {
      if (w.effect === 'hoko') {                                    // 矛：ガードを崩してよろけさせる。盾ならなおさら
        const vsShield = def.weapon.effect === 'shield';
        def.damage(dmg * (vsShield ? 0.8 : 0.5), w.ch, true); def.guarding = false; def.atk = null;
        def.stunned = Math.max(def.stunned, vsShield ? 55 : 35); def.vx = att.facing * kb * 0.4;
        addFx('crack', hx, hy, { life: 30, seed: Math.random() * 6 }); spark(hx, hy, '#9cf', 14, 6); sfx('clang'); hitstop = 8;
        popText(hx, hy - 30, vsShield ? L('盾を貫いた!!', 'SHIELD PIERCED!!') : L('ガード崩し!', 'GUARD BREAK!'), '#c0392b', vsShield ? 32 : 28);
        return;
      }
      const dt = def.weapon.traits || {};
      if (w.traits && w.traits.flat && FACE_MOVES.includes(a.name) && !dt.hole) {   // 平らな面で叩くとガードが崩れる。囲みの字のガードは崩れない
        def.damage(dmg * 0.4, w.ch, true); def.guarding = false; def.atk = null; def.stunned = Math.max(def.stunned, 25); def.vx = att.facing * kb * 0.5;
        spark(hx, hy, '#9cf', 12, 6); sfx('clang'); hitstop = 6;
        popText(hx, hy - 30, L('面打ち! ガード崩し', 'FLAT SMACK! GUARD BREAK'), '#2a6fb0', 26);
        return;
      }
      def.damage(dmg * def.weapon.guardMul, w.ch, true);
      def.vx = att.facing * kb * 0.6;
      spark(hx, hy, '#9cf', 8, 4);
      const solid = def.weapon.traits && def.weapon.traits.hole;   // 囲みの字はガードが硬いので、少し大きく出す
      popText(hx, hy - 20, solid ? L('ガード!!', 'BLOCK!!') : 'ガード', '#357', solid ? 28 : 22);
      sfx('guard');
      hitstop = 3;
      return;
    }
    if (def.sleep > 0) { def.sleep = 0; popText(def.x, def.y - 185, 'ハッ!', '#557', 26); }

    def.damage(dmg, w.ch, true);
    def.hitFlash = 4;
    if (def.weapon.effect === 'thorn' && !a.proj && att.hp > 0 && a.type !== 'super') {   // 薔：トゲが刺さって、殴った側も少し痛い
      att.damage(Math.max(1, dmg * 0.25), def.weapon.ch); att.hitFlash = 3;
      spark(att.x, att.y - 100, '#e8336d', 6, 3); popText(att.x, att.y - 170, L('チクッ', 'OUCH'), '#e8336d', 22);
    }
    att.st.hits++; att.st.best = Math.max(att.st.best, dmg);
    if (w.effect !== 'explode') sfx('hit', dmg, w.size);
    def.hitstun = Math.round(10 + kb * 1.5);
    def.vx = att.facing * kb;
    if (def.fx !== 'fly') {
      if (a.launch) def.vy = -Math.min(14, 4 + kb * a.launch);          // 浮かせる
      else if (a.type === 'strong') def.vy = -kb * 0.5;                  // 大砲の弾
      if (a.knock) { def.down = a.knock; def.downMax = a.knock; def.hitstun = 0; def.atk = null; popText(def.x, def.y - 130, 'ダウン!', '#a33', 24); }
    }
    if (a.signature) { spark(hx, hy, '#ff5b3a', 14, 8); shake = Math.max(shake, 10); }
    hitstop = Math.round(3 + Math.min(dmg, 30) * 0.3) + (a.signature ? 3 : 0);
    shake = Math.max(shake, Math.min(dmg, 40) * 0.5);
    if (dmg > 0) {
      spark(hx, hy, '#ffd84d', 10 + Math.min(dmg, 30), 6); popText(hx, hy - 30, String(Math.max(1, Math.round(dmg * DMG))), '#d33', 22 + Math.min(dmg, 30));
      // 手応え：当たった所に光の星、強い打撃はカメラがぐっと寄って、吹っ飛ぶ線が出る
      addFx('impact', hx, hy, { life: 9, size: 34 + Math.min(dmg, 30) * 2.2, color: a.signature ? '#ffe680' : '#ffffff' });
      if (dmg >= 12 || a.signature) {
        punch = Math.max(punch, 0.04 + Math.min(dmg, 40) * 0.003);
        for (let i = 0; i < 6; i++) particles.push({ x: hx - att.facing * rand(10, 60), y: hy + rand(-50, 50), vx: att.facing * rand(10, 16), vy: 0, g: 0, life: 10, color: 'rgba(255,255,255,0.85)', r: 2, streak: true });
      }
      if (dmg >= 20) { m.flash = Math.max(m.flash, 5); addFx('ring', hx, hy, { color: '#ffffff', life: 14, big: true }); }
    }
    combo(att, def, a, hx, hy);
    shapeHit(att, def, a, hx, hy);

    const top = def.y - 165, textsBefore = texts.length;
    // 魔・謎：その場でランダムな効果を選ぶ
    let fx = w.effect;
    if (fx === 'magic') { fx = ['burn', 'freeze', 'zap'][Math.floor(Math.random() * 3)]; popText(att.x, att.y - 180, '魔法!', '#7a2a9a', 24); }
    if (fx === 'mystery') {
      fx = ['burn', 'freeze', 'zap', 'poison', 'laugh', 'spicy', 'wind', 'heavy', 'slip', 'dizzy', 'sand', 'bleed', 'sticky', 'flower'][Math.floor(Math.random() * 14)];
      popText(att.x, att.y - 180, '？', '#555', 30);
    }
    switch (fx) {
      case 'burn': def.burn = 180; def.burnBy = w.ch; popText(def.x, top, 'アチチ!', '#e60', 30); break;
      case 'zap': def.stunned = 20; def.hitstun = 0; popText(def.x, top, 'ビリビリ', '#cb0', 30); break;
      case 'freeze': def.frozen = 45; def.hitstun = 0; spark(hx, hy, '#bdf', 20, 5); popText(def.x, top, 'カチーン', '#38c', 30); break;
      case 'stun':
        if (Math.random() < 0.25) { def.stunned = 35; def.hitstun = 0; popText(def.x, top, 'ビリビリ', '#cb0', 30); }
        break;
      case 'storm':                                       // 嵐：竜巻で真上に吹っ飛ばす（落ちてくるまで次は出ない）
        if (!def.twister && !(def.twistCd > 0)) {
          def.twister = 1; def.twistCd = 150;
          def.vx = 0; def.vy = -23; def.onGround = false; def.y -= 1;
          def.hitstun = 90; def.atk = null;
          shake = Math.max(shake, 12);
          popText(def.x, top, 'ゴオオッ!!', '#4a6a8a', 36);
          addFx('tornado', def.x, GROUND, { ref: def, life: 70 });
        }
        break;
      case 'heavy': if (def.fx !== 'fly') def.vy = -9; shake = Math.max(shake, 14); popText(def.x, top, 'ズドン', '#555', 34); break;
      case 'heal': {
        const h = Math.round(dmg * 0.5);
        att.hp = Math.min(100, att.hp + h);
        popText(att.x, att.y - 160, '+' + h, '#2a2', 28);
        break;
      }
      case 'explode':
        def.damage(4, w.ch); att.damage(3, w.ch);
        spark(hx, hy, '#f60', 50, 12); spark(hx, hy, '#ffd84d', 30, 8);
        shake = Math.max(shake, 20); hitstop += 4;
        popText(hx, hy - 50, 'ドカーン!!', '#e30', 48);
        break;
      case 'bite':
        att.later(12, () => { def.damage(w.power * 0.4, w.ch); popText(def.x, def.y - 150, 'ガブッ', '#8a5a2b', 30); });
        popText(att.x, att.y - 160, 'ワン!', '#8a5a2b', 34);
        break;
      case 'god': popText(def.x, def.y - 170, '天罰', '#c90', 40); spark(hx, hy, '#fff6a0', 30, 9); break;

      // ---- 追加の27字 ----
      case 'poison': def.poison = 420; popText(def.x, top, 'ジワジワ…', '#9b4dca', 28); break;
      case 'sleep':
        if (Math.random() < 0.35) { def.sleep = 180; def.hitstun = 0; popText(def.x, top, 'Zzz', '#557', 34); }
        break;
      case 'laugh': def.laugh = 45; def.hitstun = 0; popText(def.x, top, 'ワハハ!', '#e08a00', 32); break;
      case "charm": if (Math.random() > 0.5) break; def.charm = 120; popText(def.x, top, 'ドキッ', '#ff3d8a', 34); spark(def.x, def.y - 120, '#ff5b9a', 8, 3, { ch: '♥' }); break;
      case 'timestop':
        if (Math.random() < 0.25) { def.timestop = 150; def.hitstun = 0; def.vx = 0; popText(def.x, top, 'カチッ', '#446', 36); }
        break;
      case 'spicy': def.spicy = 75; def.hitstun = 0; def.spicyDir = Math.random() < 0.5 ? 1 : -1; popText(def.x, top, 'からっ!', '#e22', 34); break;
      case 'rage': if (att.hp < 60) popText(att.x, att.y - 170, 'ムキー!', '#d00', 28); break;
      case 'double': popText(att.x, att.y - 170, '×' + att.stack.toFixed(1), '#c60', 26 + att.stack * 10); break;
      case 'pierce': popText(hx, hy - 50, 'ゴン', '#555', 30); break;
      case 'crit': if (crit) { popText(hx, hy - 55, 'ズバッ!', '#c00', 40); hitstop += 4; } break;
      case 'wind': popText(def.x, top, 'ビュオー', '#5a8', 30); def.vx = att.facing * 22; break;
      case 'arrow': popText(def.x, top, 'グサッ', '#555', 26); break;
      case "breath": def.burn = Math.max(def.burn, 25); def.burnBy = w.ch; break;
      case 'cannon': spark(hx, hy, '#555', 30, 9); shake = Math.max(shake, 18); break;
      case 'cat':
        for (const t of [7, 14]) att.later(t, () => { def.damage(w.power * 0.45, w.ch); popText(def.x + rand(-20, 20), def.y - 140, 'シャッ', '#a66', 20); });
        break;
      case 'flash': m.flash = 25; def.blind = 100; popText(def.x, top, 'ピカッ', '#d0a000', 36); break;
      case 'dark': m.dark = 120; def.confused = 70; popText(def.x, top, 'まっくら', '#222', 32); break;

      // ---- 100字に向けて追加した64字 ----
      case 'combo3': followUp(att, def, 9, 0.35, 'ザン', '#555'); followUp(att, def, 18, 0.35, 'ザン!', '#c00'); break;
      case 'fist':                                    // 拳：当たるたびに、すばやいジャブが2〜3発追加で入る
        if (a.type === 'super' || a.proj) break;
        for (let i = 0; i < (Math.random() < 0.5 ? 2 : 3); i++) {
          const t = 5 + i * 5;
          followUp(att, def, t, 0.18, L('シュッ', 'JAB'), '#c0392b');
          att.later(t, () => { if (def.hp > 0) addFx('jab', def.x - att.facing * 26, def.y - rand(80, 120), { life: 7, d: att.facing, side: att.side }); });
        }
        break;
      case 'bleed': def.bleed = 300; def.bleedBy = w.ch; popText(def.x, top, '出血', '#c0392b', 28); break;
      case 'spear': popText(hx, hy - 40, 'ズドッ', '#555', 28); break;
      case 'mow': popText(def.x, top, 'ザシュッ', '#555', 30); break;
      case 'stretch': popText(hx, hy - 40, 'ビヨーン', '#c60', 28); break;
      case 'chain':                                  // 鎖：巻きついて動きを止め、ほどけるときに手元へ引き寄せる
        def.bound = 30; def.boundKind = 'chain'; def.boundBy = att; def.hitstun = 0;
        popText(def.x, top, 'ジャラジャラ', '#666', 28); sfx('clang');
        att.later(30, () => { if (def.hp > 0 && !def.untouchable()) { def.vx = sign(att.x - def.x) * 16; popText(def.x, def.y - 150, 'グイッ', '#555', 26); } });
        break;
      case 'gun': popText(def.x, top, 'バン', '#333', 22); break;
      case 'gold': coins(hx, hy, 6 + Math.round(Math.min(dmg, 20) / 3)); sfx('coin'); popText(def.x, top, 'チャリーン', '#c99a00', 26); break;   // 金：殴るたびに小判が散らばる
      case 'hoko': popText(hx, hy - 40, 'ズドッ', '#555', 28); break;
      case 'steal': {                                   // 盗：相手の必殺ゲージを盗む。4回に1回はHPも
        const s = Math.min(def.sp || 0, 15); def.sp = (def.sp || 0) - s; att.sp = Math.min(100, (att.sp || 0) + s + 5);
        if (Math.random() < 0.25) { att.hp = Math.min(100, att.hp + 3); popText(att.x, att.y - 190, '+3', '#2a2', 24); }
        spark(hx, hy, '#7a3ab0', 8, 4, { ch: '¥' }); popText(def.x, top, L('スリ!', 'YOINK!'), '#7a3ab0', 28); break;
      }
      case 'iai': popText(def.x, top, '斬!!', '#c00', 40); hitstop += 5; break;
      case 'slip': def.slip = 150; popText(def.x, top, 'ツルッ', '#2a6fb0', 28); break;
      case 'snow': if (def.fx === 'fly') break; def.snow = 70; def.hitstun = 0; def.vx = att.facing * 6; popText(def.x, top, 'ゴロゴロ', '#7aa6d6', 28); break;
      case 'dizzy': def.stunned = Math.max(def.stunned, 40); def.dizzy = 40; def.hitstun = 0; popText(def.x, top, 'ピヨピヨ', '#e0b000', 28); break;
      case 'sand': def.blind = 45; spark(def.x, def.y - 120, '#c9a36b', 12, 3); popText(def.x, top, 'ザッ', '#a07a3a', 28); break;
      case 'wave': def.vx = att.facing * 16; popText(def.x, top, 'ザブーン', '#2a6fb0', 28); break;
      case 'flower': if (Math.random() < 0.5) break; def.charm = 70; def.flower = 70; popText(def.x, top, 'ぽわ〜ん', '#ff7eb6', 28); break;
      case 'coil': def.bound = 60; def.boundKind = 'coil'; def.hitstun = 0; popText(def.x, top, 'ニョロ', '#3a8a3a', 28); break;
      case 'net': def.bound = 50; def.boundKind = 'net'; def.hitstun = 0; popText(def.x, top, 'バサッ', '#666', 28); break;
      case 'thread': def.bound = 45; def.boundKind = 'thread'; def.hitstun = 0; popText(def.x, top, 'ぐるぐる', '#999', 28); break;
      case 'sting':
        if (++def.stings % 2 === 0) { def.damage(w.power * 1.6, w.ch); popText(def.x, top, 'ブスッ!!', '#c00', 38); hitstop += 4; }
        else popText(def.x, top, 'チクッ', '#c80', 24);
        break;
      case 'bugs': def.poison = Math.max(def.poison, 300); def.bugs = 300; popText(def.x, top, 'ワサワサ', '#333', 26); break;
      case 'stomp': def.squash = 40; if (a.name !== 'stomp') popText(def.x, top, 'ぺちゃんこ', '#6b4a2b', 30); break;
      case 'rush': popText(def.x, top, 'ドドドッ', '#6b4a2b', 30); break;
      case 'beast':                                  // 獣：当てるたびに興奮して速くなる
        if (att.frenzy < 3) att.frenzy++;
        popText(att.x, att.y - 175, L('ガルル', 'GRRR') + '!'.repeat(att.frenzy), '#8a3a1a', 22 + att.frenzy * 4);
        break;
      case 'fangs': followUp(att, def, 7, 0.3, 'ガブ', '#8a5a2b'); followUp(att, def, 14, 0.3, 'ガブッ', '#8a5a2b'); break;
      case 'claw': for (const t of [5, 10, 15]) followUp(att, def, t, 0.25, 'シャッ', '#a66'); break;
      case 'sticky': def.sticky = 150; popText(def.x, top, 'ねばー', '#c9b27a', 28); break;
      case 'slurp': def.vx = -att.facing * 11; popText(def.x, top, 'ズルズル', '#c9a36b', 28); break;
      case 'dual': followUp(att, def, 6, 0.8, 'シャキン', '#557'); break;
      case 'split':
        att.splits = Math.min(4, att.splits + 1);
        followUp(att, def, 5, 0.25 * att.splits, L(`パカッ×${att.splits + 1}`, `SPLIT x${att.splits + 1}`), '#c60');
        break;
      case 'bell': def.stunned = Math.max(def.stunned, 30); def.hitstun = 0; popText(def.x, top, 'ゴーン', '#b08a2a', 34); sfx('clang'); break;
      case 'curse': def.curse = 420; def.curseBy = att; popText(def.x, top, 'うらめしや〜', '#5b2a86', 26); break;
      case 'doom':
        if (Math.random() < 0.03) {
          def.damage(def.hp, w.ch); popText(W / 2, GROUND * 0.35, '滅', '#000', 120); shake = 30; hitstop += 10; m.mono = 45;
          popText(W / 2, GROUND * 0.35 - 110, doomLine(), '#7a0000', 46);
        } else popText(def.x, top, doomLine(), '#7a0000', 24);
        break;
      case 'slow': def.slowT = 200; popText(def.x, top, 'のろ〜', '#777', 26); break;
      case 'grass':
        if (++def.grass >= 4) { def.grass = 0; def.laugh = 60; def.hitstun = 0; popText(def.x, top, 'wwwww', '#2a8a2a', 34); }
        else popText(def.x, top, 'w'.repeat(def.grass), '#2a8a2a', 24);
        break;
      case 'swoon':
        if (Math.random() < 0.3) { def.swoon = 60; def.hitstun = 0; popText(def.x, top, '尊い…', '#ff5b9a', 30); }
        break;
      case 'gloom': if (Math.random() < 0.5) break; def.gloom = Math.min(4, def.gloom + 1); sighOut(def); break;
      case 'boomerang': popText(def.x, top, 'スパッ', '#c0392b', 24); break;
      case 'love': def.charm = Math.max(def.charm, 20); popText(def.x, top, 'ドキッ', '#ff3d8a', 26); break;
      case 'breath3': def.burn = Math.max(def.burn, 30); def.burnBy = w.ch; break;

      // ---- 入れ替えで追加した11字 ----
      case 'nag': if (a.proj === 'word') popText(def.x, top, L('うっ…', 'UGH…'), '#888', 22); break;
      case 'pump':
        if (att.stack > 1.05 && Math.random() < 0.5) popText(att.x, att.y - 180, L(['キレてる!', 'ナイスバルク!', 'プロテイン飲んだ?', '肩メロン!'], ['SHREDDED!', 'NICE BULK!', 'PROTEIN TIME!', 'BOULDER SHOULDERS!'])[Math.floor(Math.random() * 4)], '#c0392b', 20 + att.stack * 6);
        break;
      case 'rockthrow': if (a.proj === 'rock') { popText(def.x, top, L('ゴツン!', 'BONK!'), '#6b5a4a', 30); spark(hx, hy, '#8a7a6a', 12, 5); } break;
      case 'sushi': if (a.proj === 'sushi') popText(def.x, top, L('うまっ!?', 'YUM!?'), '#c0392b', 24); break;
      case 'tax': def.tax = Math.max(def.tax, 300); popText(def.x, top, L('課税', 'TAXED'), '#2a8a4a', 28); break;
      case 'otsu':
        popText(att.x, att.y - 190, L('お疲れ様です', 'Good work today'), '#557', 20);
        if (Math.random() < 0.4 && def.fx !== 'otsu') { def.stunned = Math.max(def.stunned, 30); def.bow = 30; def.hitstun = 0; popText(def.x, top, L('あ、お疲れ様です…', 'Oh, you too…'), '#557', 20); }
        break;
      case 'reap': if (reaped) { popText(def.x, top - 10, L('刈り取り!!', 'REAPED!!'), '#3a1a4a', 36); hitstop += 5; spark(hx, hy, '#5a1a6a', 20, 7); } break;
      case 'law': {                                   // 法：罪状を読み上げ、3回目で起訴して大ダメージ
        def.lawN = (def.lawN || 0) + 1;
        popText(def.x, top, L(LAW_CRIMES[Math.floor(Math.random() * LAW_CRIMES.length)], LAW_CRIMES_EN[Math.floor(Math.random() * LAW_CRIMES_EN.length)]), '#2a3a6a', 26);
        if (def.lawN >= 3) {
          def.lawN = 0;
          att.later(12, () => {
            if (def.hp <= 0) return;
            def.damage(w.power * 1.3, w.ch); def.stunned = Math.max(def.stunned, 25); def.hitFlash = 4;
            popText(def.x, def.y - 200, L('起訴します!!', 'YOU ARE CHARGED!!'), '#c0392b', 36);
            spark(def.x, def.y - 100, '#ffffff', 16, 7); shake = Math.max(shake, 12); sfx('clang');
          });
        }
        break;
      }
      case 'pitch': if (a.proj === 'bouncer') popText(def.x, top, L('デッドボール!', 'BEANED!'), '#c0392b', 26); break;
      case 'kick': if (a.proj === 'kickball') { def.burn = Math.max(def.burn, 40); def.burnBy = w.ch; popText(def.x, top, L('ゴール!!', 'GOAL!!'), '#e40', 30); } break;
    }
    hitFx(att, def, fx, hx, hy);                   // 当たった瞬間の絵
    // 効果が出た（文字が出た）ら、記録・効果音・実況
    if (w.effect && texts.length > textsBefore) {
      att.st.procs++;
      sfx(w.effect === 'explode' ? 'boom' : 'proc');
    }
  }

  // =====================================================================
  // 必殺技：ゲージが満タンになると、カットイン → 字ごとの大技
  //   ゲージは 殴る・殴られる・時間 で溜まる（1試合に1回くらい）
  // =====================================================================
  const CUT_LEN = 100;                      // カットインの長さ（フレーム）
  const CHARGE_LEN = 45;                    // カットインのあと、力をためる間
  const SLOW_LEN = 150;                     // 技の間、ゆっくり（半分の速さ）にする長さ
  // [演出の種類, 技名, 英語の技名]。rain:記号 は記号が降ってくる
  const SUPERS = {
    '炎': ['fire', '紅蓮獄炎', 'CRIMSON INFERNO'], '氷': ['ice', '絶対零度', 'ABSOLUTE ZERO'], '雷': ['thunder', '百雷轟天', 'HUNDRED THUNDERS'],
    '重': ['gravity', '超重力崩壊', 'GRAVITY COLLAPSE'], '盾': ['shield', '不動金剛盾', 'UNMOVING SHIELD'], '爆': ['explode', '爆炎崩界', 'BIG BANG'],
    '犬': ['dogpile', '百犬夜行', 'HUNDRED DOG PILE'], '無': ['void', '虚無回帰', 'THE VOID'], '神': ['divine', '神罰執行', 'DIVINE JUDGMENT'],
    '毒': ['poison', '猛毒噴霧', 'TOXIC FOG'], '眠': ['rain:Z', '睡魔子守唄', 'SANDMAN LULLABY'],
    '愛': ['heartdrop', '重愛圧殺', 'CRUSHING HEAVY LOVE'], '時': ['time', '時空支配', 'TIME DOMINION'], '辛': ['hotpot', '激辛煉獄', 'SPICY HELL'],
    '怒': ['explode', '怒髪衝天', 'RAGE OVERDRIVE'], '運': ['omikuji', '大開運', 'MEGA FORTUNE'],
    '鉄': ['ironfist', '鉄拳制裁', 'IRON FIST JUSTICE'], '斬': ['slash', '一刀両断', 'CLEAN CUT IN TWO'], '拳': ['fistrush', '拳撃百烈', 'HUNDRED FIST FLURRY'],
    '跳': ['pinball', '天上跳躍', 'SKY-HIGH STOMP'], '磁': ['pierce', '電磁加速砲', 'RAILGUN'],
    '風': ['wind', '神風烈破', 'DIVINE WIND'], '嵐': ['wind', '暴嵐竜巻', 'MEGA TORNADO'], '罠': ['earth', '奈落大罠', 'BOTTOMLESS PIT'],
    '巨': ['drop', '超巨大化', 'GIGANTIFY'], '影': ['shadowclone', '影武者乱舞', 'SHADOW DOUBLE FRENZY'], '弓': ['arrows', '天弓千矢', 'THOUSAND ARROWS'],
    '竜': ['dragonroar', '竜王咆哮', "DRAGON'S ROAR"], '龍': ['risingdragon', '昇龍烈火', 'RISING DRAGON FLAME'], '龘': ['tridragon', '三龍滅却', 'TRIPLE DRAGON ANNIHILATION'],
    '砲': ['explode', '天撃一斉砲', 'FULL BARRAGE'], '猫': ['cats', '猫拳百連撃', '100 CAT PUNCHES'], '酔': ['drunkfist', '酩酊千鳥拳', 'DRUNKEN FRENZY'],
    '光': ['lightspeed', '極光閃', 'BLINDING FLASH'], '闇': ['dark', '漆黒深淵', 'PITCH-BLACK ABYSS'], '剣': ['slash', '奥義三連斬', 'SECRET TRIPLE SLASH'],
    '矛': ['pierce', '破天神矛', 'HEAVEN-SPLITTING PIKE'], '槍': ['pierce', '天穿一閃', 'HEAVEN-PIERCING SPEAR'], '薙': ['slash', '横一文字', 'HORIZON SLASH'],
    '𰻞': ['pierce', '𰻞𰻞無双', 'BIANGBIANG UNLEASHED'], '鎖': ['chainbind', '獄鎖縛陣', 'CHAIN HELL'], '銃': ['gunfire', '千発弾幕', 'SWISS CHEESE'],
    '金': ['money', '札束乱打', 'CASH SLAP'], '鋼': ['heavy', '鋼鉄鉄槌', 'STEEL HAMMER'], '癒': ['heal', '天恵大回復', 'FULL HEAL'],
    '魔': ['magic', '禁断魔法', 'FORBIDDEN MAGIC'],
    '屁': ['bigfart', '最終屁器', 'ULTIMATE WEAPON'], '忍': ['shuriken', '忍法手裏剣', 'SHURIKEN STORM'], '侍': ['slash', '居合一閃', 'FINAL QUICKDRAW'],
    '水': ['water', '蒼海洪水', 'GREAT FLOOD'], '雪': ['ice', '白魔雪崩', 'AVALANCHE'], '星': ['meteor', '流星群', 'METEOR SHOWER'],
    '岩': ['rockfall', '巨岩崩落', 'BOULDER COLLAPSE'], '砂': ['antlion', '無限蟻地獄', 'ENDLESS ANTLION PIT'], '震': ['earth', '大地震撼', 'MEGA QUAKE'],
    '波': ['water', '海神怒濤', 'TIDAL WAVE'], '花': ['bloom', '百花繚乱', 'FLOWER FRENZY'],
    '蛇': ['serpent', '大蛇縛鎖', 'GIANT SERPENT SQUEEZE'], '蜂': ['bees', '万蜂襲来', 'KILLER BEE SWARM'], '虫': ['poison', '蟲毒大群', 'BUG APOCALYPSE'],
    '牛': ['stampede', '猛牛突進', 'RAMPAGING BULL'], '馬': ['stampede', '暴走天馬', 'WILD STALLION'], '象': ['stampede', '巨象大行進', 'ELEPHANT PARADE'],
    '盗': ['steal', '怪盗参上', 'PHANTOM THIEF'], '獣': ['beast', '野生解放', 'UNLEASH THE BEAST'], '狼': ['moonwolves', '月下狼哮', 'MOONLIGHT HOWL'],
    '牙': ['jaws', '千牙噛砕', 'BONE CRUSHER'], '爪': ['bigclaw', '三爪連斬', 'TRIPLE CLAW RIPPER'], '蘇': ['phoenix', '鳳凰転生', 'PHOENIX'],
    '麺': ['noodlebowl', '無限替玉', 'ENDLESS REFILLS'], '鏡': ['mirror', '無限鏡回廊', 'INFINITE MIRROR'],
    '幻': ['phantom', '幻影乱舞', 'PHANTOM DANCE'],
    '謎': ['magic', '謎秘奥義', '???'], '鐘': ['bell', '百八煩悩鐘', '108 BELL TOLLS'],
    '鎧': ['shield', '重鎧突撃', 'FULL-ARMOR TACKLE'], '網': ['net', '一網打尽', "CATCH 'EM ALL"],
    '呪': ['ofuda', '丑刻呪詛', 'VOODOO DOLL'], '滅': ['doom', '天誅滅却', 'ANNIHILATE'],
    '薔': ['petals', '薔薇吹雪', 'ROSE BLIZZARD'],
    '草': ['prairie', '爆笑大草原', 'ROFL MEGA PRAIRIE'], '尊': ['holy', '尊光降臨', 'PRECIOUS LIGHT DESCENDS'], '推': ['rain:♡', '全霊推活', 'ALL-IN STAN'],
    '沼': ['earth', '無底泥沼', 'BOTTOMLESS SWAMP'], '鬱': ['raincloud', '憂鬱螺旋', 'SPIRAL OF GLOOM'], '卍': ['manji', '卍字大旋風', 'MEGA MANJI SPIN'],
    '恋': ['rain:♥', '恋慕暴走', 'LOVE RAMPAGE'], '叫': ['explode', '魂魄絶叫', 'SOUL SCREAM'], '覇': ['holy', '覇王威圧', "CONQUEROR'S AURA"],
    '母': ['negi', '千本葱舞', 'THOUSAND LEEK DANCE'], '筋': ['muscle', '筋肉感謝祭', 'MUSCLE FESTIVAL'], '鮨': ['sushi', '無限寿司地獄', 'ENDLESS SUSHI HELL'],
    '税': ['tax', '増税地獄', 'TAX HIKE HELL'], '罰': ['punish', '天罰覿面', 'INSTANT KARMA'], '悪': ['evil', '極悪非道', 'PURE EVIL'],
    '魂': ['souls', '魂魄解放', 'SOUL RELEASE'], '乙': ['otsu', '定時退勤', 'CLOCKING OUT AT FIVE'], '鎌': ['reaper', '死神大鎌', 'GRIM REAPER'],
    '霊': ['ghosts', '百鬼夜行', 'NIGHT PARADE OF 100 GHOSTS'], '蹴': ['kickshot', '必殺蹴球', 'SUPER SHOT'],
    '法': ['lawbook', '六法圧殺', 'LAW BOOK CRUSH'], '透': ['unseen', '無影透撃', 'UNSEEN STRIKE'], '球': ['fastball', '火球剛速', 'FIREBALL FASTBALL'],
  };
  // ふつうの字は「巨大化した字を振り回す」
  function superOf(w) {
    const s = Weapon.isSpecial(w.ch) || w.ch === '龍' ? SUPERS[w.ch] : null;
    if (s) return { theme: s[0], name: L(s[1], s[2]) };
    return { theme: 'swing', name: L(`巨大${w.ch}旋風`, `GIANT ${w.ch} WHIRLWIND`) };
  }
  // ゲージを溜める（2回目以降は溜まりにくい）
  function gainSp(f, v) {
    // 必殺技を受けている間は溜まらない（必殺技の打ち合いにならないように）
    if (!match || match.phase !== 'fight' || f.sp >= 100 || match.p.hp <= 0 || match.c.hp <= 0 || match.superSlow > 0) return;
    f.sp = Math.min(100, f.sp + v / (1 + f.spUsed * 0.8));
    if (f.sp >= 100) { f.spHold = 0; sfx('gauge'); popText(f.x, f.y - 190, L('必殺技OK! 隙をねらう…', 'SUPER READY! Waiting for an opening…'), '#d0a000', 22); }
  }
  // 出せるか（ゲージ満タン・動ける・届く）
  function canSuper(f, o) {
    return f.sp >= 100 && match && match.phase === 'fight' && !match.cutin && !match.charge && !(match.superSlow > 0) && !f.atk && o.hp > 0 && f.hp > 0
      && (f.weapon.ranged || Math.abs(o.x - f.x) < f.reach() + 170);
  }
  // 大きな隙：動けない状態異常、または攻撃を空振りしたあと（ふつうのよろけは隙にしない）
  const bigOpening = (o) => o.stunned > 0 || o.frozen > 0 || o.sleep > 0 || o.laugh > 0 || o.timestop > 0 || o.bound > 0
    || o.charm > 0 || o.swoon > 0 || o.nap > 0 || (o.atk && !o.atk.hit && o.atk.t >= o.atk.su + o.atk.act);
  // 近づいて殴る技か（飛び道具・天から降る技は、見切って避けることができない）
  const REMOTE = ['hotpot', 'dragonroar', 'risingdragon', 'tridragon', 'phoenix', 'dogpile', 'moonwolves', 'jaws', 'void', 'ofuda', 'raincloud', 'cats', 'gunfire', 'noodlebowl', 'shuriken', 'prairie', 'lightspeed', 'bigfart', 'bees', 'shadowclone', 'phantom', 'meteor', 'serpent', 'lawbook', 'fastball', 'antlion', 'bloom', 'rockfall', 'negi', 'muscle', 'sushi', 'tax', 'punish', 'evil', 'souls', 'reaper', 'ghosts', 'kickshot', 'ironfist', 'arrows', 'rain', 'heartdrop', 'divine', 'manji', 'thunder', 'holy', 'dark', 'time', 'heal', 'magic', 'earth', 'net', 'mirror', 'bell', 'gravity'];
  const meleeSuper = (f, sup) => !f.weapon.ranged && !REMOTE.includes(sup.theme.split(':')[0]);
  function startSuper(f, o) {
    if (f.thrown) { f.thrown.life = 0; f.thrown = null; }   // 投げた卍は手元に戻す
    f.sp = 0; f.spUsed++;
    f.facing = o.x >= f.x ? 1 : -1;
    const sup = superOf(f.weapon);
    // 結果は撃った時点で決まる：隙があれば必ず当たる。無ければ 40% ガード、近づく技なら 25% 見切って避ける
    const open = bigOpening(o);
    let result = 'hit';
    if (!open) {
      const r = Math.random(), away = o.x >= f.x ? 1 : -1, room = away > 0 ? W - 40 - o.x : o.x - 40;
      if (r < 0.4) result = 'guard';
      else if (r < 0.65 && meleeSuper(f, sup) && room > 140) result = 'dodge';
    }
    match.cutin = { f, o, t: 0, sup, result };
    sfx('cutin');
    if (window.Bgm) Bgm.duck(2);
  }
  // カットインが終わったら、技を出す
  function execSuper(c) {
    const { f, o, sup } = c, w = f.weapon, m = match;
    const sl = (n, fn) => f.later(Math.round(n * 1.6) + 1, fn);   // 技の中の間を長めにとる
    const landed = c.result === 'hit', ox = o.x, oy = o.y;        // 技の絵は、撃った時点で相手がいた所に出る
    const T = landed ? o : {};                                     // 外れ・ガードのときは状態異常にしない
    // 近づいて構える（飛び道具の字はその場から）
    if (meleeSuper(f, sup)) {
      const from = f.x;
      f.x = Math.max(40, Math.min(W - 40, o.x - f.facing * Math.min(140, f.reach() * 0.7)));
      // 一瞬で詰めた跡（残像の線と砂ぼこり）
      for (let i = 0; i < 14; i++) particles.push({ x: from + (f.x - from) * Math.random(), y: f.y - rand(10, 150), vx: f.facing * 4, vy: 0, g: 0, life: 18, color: 'rgba(255,255,255,0.8)', r: 2, streak: true });
      spark(f.x, f.y - 4, '#c9a36b', 12, 4);
    }
    f.atk = makeAttack(f, 'spin'); f.atk.hit = true; f.atk.label = null;
    o.atk = null; o.guarding = c.result === 'guard';
    if (c.result === 'dodge') {                              // 見切った：大きく跳んで逃げる
      const away = o.x >= f.x ? 1 : -1;
      o.vx = away * 13; o.vy = -10; o.onGround = false; o.y -= 1; o.backT = 26;
      popText(o.x, o.y - 185, L('見切った!', 'DODGED!'), '#2a6fb0', 30);
      for (let i = 0; i < 10; i++) particles.push({ x: o.x + rand(-20, 20), y: o.y - rand(10, 150), vx: -away * 2, vy: 0, g: 0, life: 16, color: 'rgba(120,180,255,0.7)', r: 2, streak: true });
    }
    const dmg = Math.min(30, 15 + w.power * 1.1);
    const hit = (mul, kbx, extra) => {                       // 必殺技の1発
      if (o.hp <= 0) return;
      if (c.result === 'dodge') {                            // 外れ：誰もいない所に技が出る
        if (!c.said) { c.said = true; popText(ox, oy - 150, L('スカッ…', 'WHIFF…'), '#777', 36); }
        return;
      }
      if (c.result === 'guard') {                            // ガード：ダメージ4分の1、効果なし
        o.damage(dmg * mul * 0.25, w.ch, true); o.guarding = true;
        spark(o.x + f.facing * -10, o.y - 90, '#9cf', 14, 6); sfx('guard');
        if (!c.said) { c.said = true; popText(o.x, o.y - 160, L('ガードした!', 'BLOCKED!'), '#2a6fb0', 34); }
        if (kbx != null) o.vx = f.facing * kbx * 0.3;
        return;
      }
      o.damage(dmg * mul, w.ch, true);
      o.hitFlash = 4; o.hitstun = Math.max(o.hitstun, 30);
      if (kbx != null && o.fx !== 'fly' && !o.twister) { o.vx = f.facing * kbx; }
      const hx = o.x, hy = o.y - 90;
      addFx('impact', hx, hy, { life: 12, size: 70 + mul * 60, color: '#fff6c0' });
      spark(hx, hy, '#ffd84d', 20, 9);
      popText(hx, hy - 40, String(Math.round(dmg * mul * DMG / (o.tough || 1))), '#d33', 40);
      if (extra) extra();
    };
    const finish = (mul, kbx) => {                           // 決めの一撃：大きく揺らして止める
      hit(mul, kbx);
      // 字の効果も一緒に出す（特別な字）
      if (!landed) { hitstop = 8; shake = 10; return; }
      if (w.effect && o.hp > 0) { o.guarding = false; const vx = o.vx; onHit(f, o, { type: 'super', pow: 0, kb: 0.4, charge: 0 }, o.x, o.y - 90); o.vx = vx; }
      hitstop = 24; shake = 30; punch = 0.28; m.flash = Math.max(m.flash, 12);
      sfx('superhit');
    };
    const theme = sup.theme.split(':')[0], sym = sup.theme.split(':')[1];
    switch (theme) {
      case 'fire':
        addFx('flamepillar', ox, GROUND, { life: 70, blue: w.ch === '焔' }); sfx('fire');
        sl(10, () => { finish(1, 10); T.burn = Math.max(o.burn, 300); T.burnBy = w.ch; });
        break;
      case 'ice':
        sfx('ice'); addFx('shards', ox, oy - 90, { life: 30, n: 18, size: 2 });
        sl(8, () => { finish(1, 2); T.frozen = Math.max(o.frozen, 110); landed && addFx('iceblock', ox, oy, { life: 110, ref: o }); });
        break;
      case 'thunder':
        for (let i = 0; i < 5; i++) sl(i * 4, () => { addFx('bolt', ox + rand(-60, 60), oy - 80, { life: 14, big: true }); sfx('zap'); m.flash = Math.max(m.flash, 10); });
        sl(18, () => { finish(1, 6); T.stunned = Math.max(o.stunned, 70); });
        break;
      case 'wind':
        addFx('swirl', ox, oy - 80, { life: 50, big: true });
        sl(8, () => {
          finish(0.9, 0);
          if (landed && o.fx !== 'fly' && o.hp > 0) { T.twister = 1; T.twistCd = 150; T.vx = 0; T.vy = -26; T.onGround = false; o.y -= 1; T.hitstun = 90; addFx('tornado', o.x, GROUND, { ref: o, life: 80 }); }
        });
        break;
      case 'water':
        addFx('bigwave', f.x, GROUND, { life: 50, dir: f.facing }); sfx('water');
        sl(12, () => { finish(1, 26); T.slip = Math.max(o.slip, 200); });
        break;
      case 'explode':
        sl(10, () => { addFx('explosion', ox, oy - 80, { life: 50, r: 190 }); finish(1.15, 18); sfx('boom'); });
        break;
      case 'slash':
        for (let i = 0; i < 4; i++) sl(i * 5, () => { addFx('crescent', ox, oy - 90, { life: 14, dir: i % 2 ? -1 : 1, size: 1.4, rot: rand(-0.6, 0.6) }); sfx('slash'); hit(0.15, 3); });
        sl(24, () => { addFx('crescent', ox, oy - 90, { life: 22, dir: f.facing, size: 2.6, rot: 0, flat: true }); finish(0.6, 14); });
        break;
      case 'pierce':
        sl(8, () => { addFx('beam', f.x, f.y - 90, { life: 26, dir: f.facing }); finish(1, 22); });
        break;
      case 'beast':
        for (let i = 0; i < 3; i++) sl(i * 6, () => { addFx('claw', ox + rand(-20, 20), oy - 90, { life: 22, big: true }); sfx('slash'); hit(0.15, 2); });
        sl(20, () => { addFx('teeth', ox, oy - 90, { life: 30, big: true }); finish(0.7, 14); });
        break;
      case 'barrage':
        for (let i = 0; i < 8; i++) sl(i * 3, () => { addFx('impact', ox + rand(-40, 40), oy - rand(40, 140), { life: 8, size: 60, color: '#ffffff' }); sfx('hit', 6, w.size); hit(0.07, 1); });
        sl(28, () => finish(0.6, 18));
        break;
      case 'rain':
        for (let i = 0; i < 40; i++) particles.push({ x: ox + rand(-160, 160), y: rand(-200, 0) + oy - 260, vx: 0, vy: rand(4, 9), g: 0.15, life: 70, color: ['#ff5b9a', '#ffd84d', '#2a8a2a', '#557', '#ff7eb6'][i % 5], r: 3, ch: sym });
        sl(16, () => finish(1, 8));
        break;
      case 'dark':
        addFx('vignette', ox, oy - 90, { life: 80, color: '25,0,35' });   // 画面全体は暗くしない（グレーアウトに見えるので）
        addFx('cloud', ox, oy - 80, { life: 70, color: '60,30,90' });
        sl(14, () => { addFx('eyes', ox, oy - 120, { life: 40 }); finish(1, 10); });
        break;
      case 'holy':
        addFx('pillar', ox, oy, { color: '255,235,140', life: 50, wide: 2.2 }); m.flash = 20;
        sl(10, () => finish(1, 8));
        break;
      case 'earth':
        cracks.push({ x: ox, life: 120, seed: Math.random() * 1000 }); cracks.push({ x: ox + 80, life: 120, seed: Math.random() * 1000 });
        addFx('spikes', ox, GROUND, { life: 40 }); sfx('boom');
        sl(8, () => { finish(1, 4); if (o.fx !== 'fly') { T.down = 70; T.downMax = 70; T.vy = -12; } });
        break;
      case 'poison':
        addFx('cloud', ox, oy - 70, { life: 90, color: w.ch === '屁' ? '154,160,74' : '155,77,202' });
        sl(14, () => { finish(0.8, 4); T.poison = Math.max(o.poison, 600); T.stunned = Math.max(o.stunned, 40); });
        break;
      case 'heavy':
        addFx('weight', ox, oy - 70, { life: 34, big: true });
        sl(12, () => { finish(1.1, 6); T.squash = 60; if (o.fx !== 'fly') { T.down = 60; T.downMax = 60; } });
        break;
      case 'time':
        addFx('clock', ox, oy - 100, { life: 60, big: true });
        sl(8, () => { finish(0.9, 0); T.timestop = Math.max(o.timestop, 200); T.vx = 0; });
        break;
      case 'heal':
        f.hp = Math.min(100, f.hp + 25);
        for (let i = 0; i < 24; i++) spark(f.x + rand(-40, 40), f.y - rand(0, 160), '#3cbf5a', 1, 1, { vy: -2, g: -0.03, ch: '✚' });
        popText(f.x, f.y - 180, '+25', '#2a2', 40);
        addFx('pillar', f.x, f.y, { color: '160,255,170', life: 50, wide: 1.6 });
        sl(12, () => finish(0.6, 6));
        break;
      case 'magic':
        addFx('circle', ox, oy, { life: 50, color: '#a050ff', big: true });
        sl(12, () => {
          const k = ['fire', 'ice', 'thunder'][Math.floor(Math.random() * 3)];
          if (k === 'fire') { addFx('flamepillar', ox, GROUND, { life: 60 }); T.burn = 240; T.burnBy = w.ch; sfx('fire'); }
          if (k === 'ice') { T.frozen = 90; landed && addFx('iceblock', ox, oy, { life: 90, ref: o }); sfx('ice'); }
          if (k === 'thunder') { addFx('bolt', ox, oy - 80, { life: 14, big: true }); T.stunned = 60; sfx('zap'); }
          finish(1, 8);
        });
        break;
      case 'swing': {                                        // ふつうの字：字が巨大化して、3回振り回す
        popText(f.x, f.y - 240, L('巨大化!!', 'GIGANTIFY!!'), '#d0a000', 34); sfx('gauge');
        for (let i = 1; i <= 8; i++) sl(i, () => { f.giant = 1 + 1.8 * i / 8; });
        const swing = (mv) => { f.atk = makeAttack(f, mv); Object.assign(f.atk, { t: 0, su: 3, act: 12, rec: 10, hit: true, label: null }); sfx('swing', w.size * 3); };   // 横薙ぎ → 叩きつけ → 一回転
        sl(10, () => swing('slash')); sl(13, () => { addFx('crescent', ox, oy - 90, { life: 16, dir: f.facing, size: 2.2, rot: -0.4 }); sfx('slash'); hit(0.2, 3); });
        sl(20, () => swing('smash')); sl(23, () => { addFx('crescent', ox, oy - 90, { life: 16, dir: -f.facing, size: 2.2, rot: 0.4 }); sfx('slash'); hit(0.2, 3); });
        sl(30, () => { f.giant = 3.1; swing('spin'); f.atk.act = 16; });
        sl(34, () => { addFx('crescent', ox, oy - 90, { life: 24, dir: f.facing, size: 3, rot: 0, flat: true }); finish(0.8, 24); });
        for (let i = 1; i <= 6; i++) sl(38 + i, () => { f.giant = 3.1 - 2.1 * i / 6; });   // 技が終わったら元の大きさに
        break;
      }
      case 'doom':                                           // 滅：画面が暗くなり、巨大な「滅」が叩きつけられて大爆発
        addFx('tint', W / 2, H / 2, { life: 26, color: '25,0,0', a: 0.55 });   // 決めの光の前に明るさを戻す（灰色に見えないように）
        addFx('vignette', ox, oy - 90, { life: 70, color: '70,0,0' }); sfx('zap');
        addFx('bigdrop', ox, oy, { life: 46, w });
        sl(14, () => {
          addFx('explosion', ox, oy - 80, { life: 50, r: 230 }); sfx('boom');
          popText(ox, oy - 280, doomLine(), '#7a0000', 40);
          finish(1.1, 6); addFx('ring', ox, oy - 60, { color: '#c0392b', life: 22, big: true }); addFx('ring', ox, oy - 60, { color: '#000000', life: 30, big: true });
          cracks.push({ x: ox - 60, life: 120, seed: Math.random() * 1000 }); cracks.push({ x: ox + 60, life: 120, seed: Math.random() * 1000 });
          if (o.fx !== 'fly') { T.down = 60; T.downMax = 60; }
        });
        break;
      case 'omikuji':                                        // 運：大量の「大吉」のおみくじが四方から飛んできて殴る
        for (let i = 0; i < 28; i++) {
          const a = rand(0, TAU);
          sl(i * 0.8, () => addFx('kuji', ox + rand(-40, 40), oy - 100 + rand(-50, 40), { life: 16, a, rot0: rand(-3, 3) }));
          sl(i * 0.8 + 5, () => { addFx('impact', ox + rand(-30, 30), oy - rand(60, 130), { life: 7, size: 50, color: '#ffe680' }); if (i % 2 === 0) { sfx('hit', 6, w.size); hit(0.05, 0.5); } });
        }
        sl(26, () => addFx('kuji', ox, oy - 100, { life: 26, a: f.facing > 0 ? Math.PI : 0, rot0: 0, final: true }));
        sl(31, () => {
          finish(0.8, 16); popText(ox, oy - 250, L('大吉!!', 'JACKPOT!!'), '#d33', 54); sfx('proc');
          for (let i = 0; i < 30; i++) spark(ox, oy - 120, ['#d33', '#ffd84d', '#ffffff'][i % 3], 1, 9, { ch: i % 3 ? '✦' : '吉' });
        });
        break;
      case 'petals':                                         // 薔：無数の花びらが渦を巻いて、相手を切り刻む
        addFx('petalswirl', ox, oy - 100, { life: 70 }); petals(ox, oy - 120, 30, 160);
        for (let i = 0; i < 10; i++) sl(4 + i * 2, () => { petals(ox, oy - 100, 5, 50); addFx('crescent', ox + rand(-30, 30), oy - rand(60, 130), { life: 10, dir: i % 2 ? -1 : 1, size: 0.9, rot: rand(-1, 1), color: '#ff7eb6' }); if (i % 2 === 0) sfx('slash'); hit(0.06, 0.5); });
        sl(26, () => { finish(0.8, 14); petals(ox, oy - 100, 50, 140); });
        break;
      case 'ironfist':                                       // 鉄：空から巨大な鉄の拳が降ってきて、叩き潰す
        addFx('ironfist', ox, GROUND, { life: 56 });
        sl(8, () => {
          finish(1.1, 4); sfx('clang'); addFx('ring', ox, GROUND - 20, { color: '#ffffff', life: 20, big: true });
          cracks.push({ x: ox - 50, life: 120, seed: Math.random() * 1000 }); cracks.push({ x: ox + 50, life: 120, seed: Math.random() * 1000 });
          if (o.fx !== 'fly') { T.squash = 50; T.down = 50; T.downMax = 50; }
        });
        break;
      case 'arrows':                                         // 弓：いつも撃っている矢が、空から雨のように降り注ぐ
        for (let i = 0; i < 26; i++) sl(i * 0.9, () => { addFx('arrowfall', ox + rand(-120, 120), GROUND - rand(4, 26), { life: 46, tilt: -f.facing * rand(0.2, 0.45) }); if (i % 3 === 0) sfx('shoot'); });
        for (let i = 0; i < 7; i++) sl(7 + i * 3, () => { if (i % 2 === 0) sfx('hit', 6, w.size); hit(0.08, 0.5); });
        sl(28, () => finish(0.8, 8));
        break;
      case 'money':                                          // 金：札束が舞い上がり、札束で何度もはたく
        bills(ox, oy - 140, 40, 170); sfx('coin');
        for (let i = 0; i < 6; i++) sl(6 + i * 3, () => { addFx('billslap', ox, oy - 100, { life: 12, dir: i % 2 ? -1 : 1 }); sfx('slap'); hit(0.1, 1); bills(ox, oy - 100, 4, 40); });
        sl(26, () => { finish(0.7, 14); bills(ox, oy - 100, 30, 120); coins(ox, oy - 100, 20); });
        break;
      case 'steal':                                          // 盗：目にも止まらぬ速さで背後に回り込み、最後に懐から盗む
        for (let i = 0; i < 3; i++) sl(4 + i * 7, () => {
          const from = f.x; f.x = Math.max(40, Math.min(W - 40, o.x + (f.x < o.x ? 70 : -70))); f.facing = o.x >= f.x ? 1 : -1;
          for (let j = 0; j < 12; j++) particles.push({ x: from + (f.x - from) * Math.random(), y: f.y - rand(20, 150), vx: 0, vy: 0, g: 0, life: 14, color: 'rgba(150,80,210,0.8)', r: 2, streak: true });
          addFx('crescent', ox, oy - 90, { life: 12, dir: f.facing, size: 1.3, rot: rand(-0.5, 0.5) }); sfx('slash'); hit(0.15, 1);
        });
        sl(26, () => { finish(0.6, 10); if (landed) { f.hp = Math.min(100, f.hp + 15); popText(f.x, f.y - 200, L('+15 いただき!', '+15 YOINK!'), '#7a3ab0', 34); coins(f.x, f.y - 120, 12); } });
        break;
      case 'shield':                                         // 盾・鎧：巨大な盾ごと体当たり
        addFx('shield', f.x - f.facing * 220, f.y - 110, { life: 46, tx: ox - f.facing * 55, ch: w.ch }); sfx('clang');
        sl(9, () => { finish(1, 30); T.stunned = Math.max(o.stunned, 50); });
        break;
      case 'net':                                            // 網：空から大きな網が落ちてきて、からめ取る
        addFx('netdrop', ox, oy, { life: 150, ref: landed ? o : null });
        sl(7, () => { finish(0.8, 0); T.bound = Math.max(o.bound || 0, 150); T.boundKind = 'net'; T.vx = 0; });
        break;
      case 'mirror':                                         // 鏡：まわりに鏡が並び、光が反射して集まる
        addFx('mirrors', ox, oy - 100, { life: 70 }); sfx('ice');
        for (let i = 0; i < 3; i++) sl(8 + i * 3, () => { sfx('guard'); hit(0.12, 0); });
        sl(18, () => { m.flash = Math.max(m.flash, 16); finish(0.9, 10); T.blind = Math.max(o.blind || 0, 200); });
        break;
      case 'bell':                                           // 鐘：巨大な鐘をかぶせて、ゴーンと鳴らす
        addFx('bell', ox, oy, { life: 90, ref: landed ? o : null });
        sl(8, () => { finish(1, 0); sfx('temple'); T.stunned = Math.max(o.stunned, 90); T.vx = 0; });
        break;
      case 'clone':                                          // 分・幻：字の分身が四方から次々に飛んでくる
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + rand(-0.2, 0.2);
          sl(i * 3, () => addFx('clone', ox, oy - 90, { life: 20, a, w }));
          sl(i * 3 + 5, () => { addFx('impact', ox + rand(-30, 30), oy - rand(60, 120), { life: 8, size: 60, color: '#ffffff' }); sfx('hit', 8, w.size); hit(0.08, 1); });
        }
        sl(26, () => { addFx('clone', ox, oy - 90, { life: 18, a: f.facing > 0 ? Math.PI : 0, w, final: true }); });
        sl(31, () => finish(0.7, 18));
        break;
      case 'stampede':                                       // 牛・象・馬：字の群れが地響きを立てて駆け抜ける
        addFx('stampede', ox, GROUND, { life: 60, dir: f.facing, w }); sfx('boom');
        for (let i = 0; i < 3; i++) sl(10 + i * 3, () => { shake = Math.max(shake, 10); hit(0.12, 3); });
        sl(19, () => { finish(0.8, 16); if (o.fx !== 'fly') { T.down = 60; T.downMax = 60; } });
        break;
      case 'manji':                                          // 卍：たくさんの卍が飛んでいって次々に当たり、最後に巨大な卍
        for (let i = 0; i < 14; i++) sl(i * 2, () => addFx('manji', f.x, f.y - rand(60, 200), { life: 16, tx: ox + rand(-30, 30), ty: oy - rand(50, 150), arc: rand(-90, 90), w, size: 40 + 10 * Math.floor(rand(0, 4)) }));
        for (let i = 0; i < 14; i++) sl(i * 2 + 10, () => { hit(0.05, 1); sfx('slash'); });
        sl(34, () => addFx('manji', f.x, f.y - 120, { life: 18, tx: ox, ty: oy - 100, arc: -60, w, size: 220, spin: 0.8 }));
        sl(45, () => finish(0.6, 18));
        break;
      case 'divine':                                         // 神：天が開き、光の柱が降り注ぎ、最後に巨大な『神』が降臨して押しつぶす
        addFx('godrays', ox, oy, { life: 75 }); m.flash = Math.max(m.flash, 10); sfx('gauge');
        for (let i = 0; i < 6; i++) sl(5 + i * 3, () => { addFx('pillar', ox + rand(-110, 110), GROUND, { color: '255,240,170', life: 24, wide: 1.1 }); sfx('zap'); shake = Math.max(shake, 8); hit(0.07, 0); });
        sl(24, () => addFx('bigdrop', ox, oy, { life: 50, w, divine: true }));
        sl(33, () => {
          finish(1.25, 4); m.flash = 6;                     // 白く飛ばしすぎると、降りてきた『神』が見えなくなる
          if (o.fx !== 'fly') { T.squash = 50; T.down = 60; T.downMax = 60; }
          cracks.push({ x: ox, life: 90, seed: Math.random() * 1000 });
          spark(ox, GROUND - 20, '#fff6a0', 40, 10);
        });
        break;
      case 'chainbind':                                      // 鎖：鎖でぐるぐる巻きにして、締め付けて大ダメージ
        addFx('chainwrap', ox, oy, { life: 78, ref: landed ? o : null });
        if (landed) { T.vx = 0; T.bound = Math.max(o.bound || 0, 80); T.boundKind = 'superchain'; T.boundBy = f; }
        sfx('guard');
        for (let i = 0; i < 4; i++) sl(14 + i * 6, () => { shake = Math.max(shake, 6 + i * 4); popText(ox + rand(-30, 30), oy - 180 - i * 8, i < 3 ? L('ギリッ', 'CREAK') : L('ギリギリッ', 'CRRREAK'), '#444', 24 + i * 4); sfx('guard'); hit(0.08, 0); });
        sl(42, () => { finish(1.3, 0); popText(ox, oy - 220, L('ギュウウッ!!', 'SQUEEEZE!!'), '#222', 40); });
        break;
      case 'heartdrop':                                      // 愛：巨大なハート（重い愛）が空から落ちてきて押しつぶす
        addFx('bigheart', ox, oy, { life: 52 });
        sl(14, () => {
          finish(1.1, 4); if (o.fx !== 'fly') { T.squash = 50; T.down = 50; T.downMax = 50; }
          cracks.push({ x: ox, life: 90, seed: Math.random() * 1000 });
          for (let i = 0; i < 24; i++) particles.push({ x: ox + rand(-60, 60), y: GROUND - rand(10, 60), vx: rand(-7, 7), vy: rand(-11, -4), g: 0.35, life: 50, color: ['#ff3d7f', '#ff8fb8'][i % 2], r: 3, ch: '♥' });
        });
        break;
      case 'gravity':                                        // 重：黒い重力の玉に吸い込まれて押しつぶされる
        addFx('blackhole', ox, oy - 230, { life: 72 }); m.dark = Math.max(m.dark, 60);
        for (let i = 0; i < 4; i++) sl(6 + i * 3, () => { hit(0.08, 0); T.vx = 0; o.y = Math.min(o.y, GROUND); });
        // 暗いまま白く光ると灰色になるので、決めの瞬間に暗さを消す
        sl(22, () => { m.dark = 0; finish(1.1, 4); T.squash = 60; if (o.fx !== 'fly') { T.down = 60; T.downMax = 60; } cracks.push({ x: ox, life: 90, seed: Math.random() * 1000 }); });
        break;
      // ---- 入れ替えで追加した11字 ----
      case 'antlion':                                        // 砂：相手の足元がすり鉢状にくぼみ、砂の渦で沈んでいく。最後に砂が噴き上がる
        addFx('sandpit', ox, GROUND, { life: 96, ref: landed ? o : null }); sfx('water');
        if (landed) { T.vx = 0; T.bound = Math.max(o.bound || 0, 70); T.boundKind = 'sand'; }
        popText(ox, oy - 230, L('ズズズズ…', 'SHHHHH…'), '#a07a3a', 30);
        for (let i = 0; i < 12; i++) sl(4 + i * 1.6, () => { if (landed && o.fx !== 'fly') o.sinkDepth = Math.min(115, (i + 1) * 10); if (i % 3 === 0) { sfx('hit', 4, 40); hit(0.06, 0); } });
        sl(26, () => {
          if (landed) { o.sinkDepth = 0; if (o.fx !== 'fly') { T.vy = -15; T.onGround = false; o.y -= 1; } }
          for (let i = 0; i < 40; i++) particles.push({ x: ox + rand(-50, 50), y: GROUND - rand(0, 20), vx: rand(-5, 5), vy: rand(-16, -6), g: 0.4, life: 50, color: ['#d9b878', '#c9a36b', '#b08a50'][i % 3], r: 4 });
          shake = Math.max(shake, 18); finish(1.1, 4);
        });
        break;
      case 'bloom':                                          // 花：相手のまわりの地面から花が次々に咲き広がり、最後に巨大な花が開いて花びらの嵐
        for (let i = 0; i < 22; i++) sl(i * 0.8, () => { const d = (i % 2 ? 1 : -1) * (20 + i * 9); addFx('flower', ox + d + rand(-8, 8), GROUND - rand(0, 8), { life: 70 - i, hue: i % 4, s: rand(0.8, 1.3) }); });
        for (let i = 0; i < 6; i++) sl(6 + i * 3, () => { petals(ox, oy - 80, 6, 70); hit(0.06, 0); });
        sl(22, () => addFx('bigflower', ox, GROUND, { life: 54, back: true }));
        sl(30, () => { petals(ox, oy - 120, 60, 240); finish(1, 8); m.flash = 3; T.flower = Math.max(o.flower || 0, 120); T.charm = Math.max(o.charm || 0, 80); });
        break;
      case 'rockfall':                                       // 岩：たくさんの岩が落ちてきて、最後に大きい岩
        for (let i = 0; i < 26; i++) sl(i * 0.8, () => addFx('fallobj', ox + rand(-150, 150), GROUND - rand(4, 20), { life: 32, obj: 'rock', rs: rand(1.2, 2.4), seed: rand(0, 10), rot: rand(-0.6, 0.6) }));
        for (let i = 0; i < 8; i++) sl(8 + i * 2, () => { if (i % 2 === 0) { sfx('boom'); shake = Math.max(shake, 8); } hit(0.05, 0.5); });
        sl(26, () => addFx('bigobj', ox, oy - 60, { life: 50, obj: 'rock', s: 6.5, seed: 3.3, rot: 0.1 }));
        sl(33, () => { finish(1.1, 4); if (o.fx !== 'fly') { T.squash = 60; T.down = 60; T.downMax = 60; } cracks.push({ x: ox - 60, life: 120, seed: Math.random() * 1000 }); cracks.push({ x: ox + 60, life: 120, seed: Math.random() * 1000 }); });
        break;
      // ---- 2026-11 に作り直した必殺技（その2：同じ演出だった字）----
      case 'hotpot':                                         // 辛：激辛スープの大鍋に落とされ、湯気と炎
        addFx('hotpot', ox, GROUND, { life: 96, back: true }); addFx('hotpot', ox, GROUND, { life: 96 });
        popText(ox, oy - 250, L('グツグツ…', 'BUBBLE BUBBLE…'), '#c0392b', 30); sfx('fire');
        if (landed && o.fx !== 'fly') { T.vx = 0; T.bound = Math.max(o.bound || 0, 72); T.boundKind = 'sand'; for (let i = 0; i < 6; i++) sl(i, () => { o.sinkDepth = Math.min(80, (i + 1) * 14); }); }
        for (let i = 0; i < 6; i++) sl(8 + i * 3, () => { hit(0.06, 0); if (i % 2 === 0) popText(ox + rand(-50, 50), oy - rand(160, 220), L('からっ!!', 'HOT!!'), '#e22', 26); });
        sl(28, () => { if (landed) { o.sinkDepth = 0; if (o.fx !== 'fly') { T.vy = -16; T.onGround = false; o.y -= 1; } } addFx('flamepillar', ox, GROUND, { life: 40 }); finish(1, 6); T.spicy = 90; T.spicyDir = Math.random() < 0.5 ? 1 : -1; });
        break;
      case 'dragonroar': {                                   // 竜：背後に巨大な竜の影が現れて咆哮し、炎のブレスで焼き払う
        const d = ox >= f.x ? 1 : -1, mx = f.x - d * 40, my = f.y - 300;
        addFx('dragonshade', f.x - d * 120, GROUND, { life: 80, d, back: true });
        sl(8, () => { popText(f.x, f.y - 330, L('グオオオオ!!', 'ROOOAAAR!!'), '#8a1c14', 44); addFx('rings', mx + d * 120, my + 40, { life: 30 }); shake = Math.max(shake, 20); sfx('boom'); });
        sl(14, () => { addFx('breath', mx + d * 150, my + 50, { life: 30, tx: ox, ty: oy - 80 }); sfx('fire'); });
        for (let i = 0; i < 5; i++) sl(16 + i * 2, () => hit(0.08, 1));
        sl(28, () => { finish(0.9, 14); T.burn = Math.max(o.burn || 0, 240); T.burnBy = w.ch; });
        break;
      }
      case 'risingdragon':                                   // 龍：足元から炎の龍が昇り、相手を巻き込んで空へ昇る
        addFx('firedragon', ox, GROUND, { life: 60 }); sfx('fire');
        sl(4, () => { if (landed && o.fx !== 'fly') { T.vy = -22; T.onGround = false; o.y -= 1; T.hitstun = 60; } });
        for (let i = 0; i < 5; i++) sl(4 + i * 2.5, () => hit(0.07, 0));
        sl(20, () => { addFx('explosion', ox, oy - 260, { life: 40, r: 150 }); finish(0.9, 4); T.burn = Math.max(o.burn || 0, 240); T.burnBy = w.ch; popText(ox, oy - 320, L('昇龍!!', 'RISING DRAGON!!'), '#c0392b', 44); });
        break;
      case 'tridragon':                                      // 龘：三つ首の龍がらせんに昇り、炎と雷が降り注ぐ
        addFx('tridragon', ox, GROUND, { life: 96, back: true }); sfx('boom'); shake = Math.max(shake, 14);
        for (let i = 0; i < 12; i++) {
          sl(12 + i * 1.6, () => { const x = ox + rand(-160, 160); if (i % 2) { addFx('bolt', x, oy - 80, { life: 12, big: i % 4 === 1 }); sfx('zap'); } else addFx('meteor', x, GROUND - 10, { life: 16, from: rand(-0.6, 0.6), s: rand(0.8, 1.2), fire: true }); });
          sl(14 + i * 1.6, () => hit(0.045, 0.3));
        }
        sl(34, () => { addFx('bolt', ox, oy - 80, { life: 20, big: true }); addFx('flamepillar', ox, GROUND, { life: 44 }); m.flash = Math.max(m.flash, 10); finish(1.1, 6); T.burn = Math.max(o.burn || 0, 200); T.burnBy = w.ch; T.stunned = Math.max(o.stunned || 0, 50); });
        break;
      case 'phoenix':                                        // 蘇：不死鳥が羽ばたいて炎の羽根が降り注ぎ、自分のHPも少し回復
        addFx('phoenix', f.x, f.y - 200, { life: 46, tx: ox, ty: oy - 140 }); sfx('fire');
        for (let i = 0; i < 6; i++) sl(6 + i * 2.5, () => { for (let k = 0; k < 5; k++) particles.push({ x: ox + rand(-150, 150), y: oy - rand(220, 320), vx: rand(-1.5, 1.5), vy: rand(1, 3), g: 0.05, life: 70, color: ['#ff8a1f', '#ffd84d', '#e8321a'][k % 3], r: 4, petal: true, rot: rand(0, 6), vr: rand(-0.2, 0.2) }); hit(0.06, 0); });
        sl(24, () => { f.hp = Math.min(100, f.hp + 15); popText(f.x, f.y - 210, '+15', '#2a2', 36); addFx('pillar', f.x, f.y, { color: '255,180,80', life: 34, wide: 1.2 }); finish(0.9, 8); T.burn = Math.max(o.burn || 0, 200); T.burnBy = w.ch; });
        break;
      case 'dogpile':                                        // 犬：犬の群れが駆け込んで、もみくちゃにする
        addFx('dogs', ox, GROUND, { life: 70, n: 6 }); popText(ox, oy - 240, L('ワンワンワン!!', 'WOOF WOOF WOOF!!'), '#8a5a2b', 34); sfx('vs');
        for (let i = 0; i < 9; i++) sl(8 + i * 2, () => { hit(0.05, 0.3); if (i % 3 === 0) sfx('hit', 5, 60); });
        sl(28, () => { finish(0.9, 12); popText(ox, oy - 270, L('ガブッ!!', 'CHOMP!!'), '#8a5a2b', 40); });
        break;
      case 'moonwolves':                                     // 狼：満月が昇って遠吠えし、狼の群れが飛びかかる
        addFx('moonnight', ox, 0, { life: 90, back: true });
        sl(5, () => { popText(f.x, f.y - 230, L('アオーーン!!', 'AWOOOOO!!'), '#445', 40); sfx('vs'); });
        for (let i = 0; i < 5; i++) {
          sl(9 + i * 3, () => addFx('wolfleap', ox, oy, { life: 14, d: i % 2 ? 1 : -1 }));
          sl(13 + i * 3, () => { addFx('claw', ox + rand(-20, 20), oy - 100, { life: 18, big: true }); sfx('slash'); hit(0.07, 1); });
        }
        sl(30, () => finish(0.8, 14));
        break;
      case 'jaws':                                           // 牙：地面から巨大な牙の口が現れ、噛み砕く
        addFx('jaws', ox, oy, { life: 56 }); sfx('boom');
        sl(6.5, () => { shake = Math.max(shake, 14); sfx('clang'); hit(0.25, 0); popText(ox, oy - 230, L('ガブッ!', 'CHOMP!'), '#8a1c14', 34); });
        sl(15.5, () => { shake = Math.max(shake, 24); finish(1, 4); popText(ox, oy - 270, L('ガブガブッ!!', 'CHOMP CHOMP!!'), '#8a1c14', 44); });
        break;
      case 'bigclaw':                                        // 爪：巨大な3本の爪痕が画面ごと裂く
        for (let i = 0; i < 3; i++) sl(i * 5, () => { addFx('clawtear', ox + (i - 1) * 60, oy - 100, { life: 46 - i * 6, k: i }); sfx('slash'); shake = Math.max(shake, 10); hit(i < 2 ? 0.2 : 0, 2); });
        sl(14, () => finish(0.7, 14));
        break;
      case 'void':                                           // 無：画面の色が抜けて白黒になり、相手が「無」に吸い込まれる
        m.mono = Math.max(m.mono || 0, 70); addFx('voidhole', ox, oy - 100, { life: 66, w });
        popText(ox, oy - 260, L('…………', '…………'), '#555', 34);
        for (let i = 0; i < 5; i++) sl(6 + i * 3, () => hit(0.06, 0));
        sl(26, () => { finish(1, 0); T.vx = 0; });
        break;
      case 'ofuda':                                          // 呪：呪いのお札が何枚も貼りついて燃える
        for (let i = 0; i < 8; i++) sl(i * 1.5, () => { addFx('ofuda', f.x + f.facing * 40, f.y - 120, { life: 70 - i * 2, ref: landed ? o : null, ox: ox, oy: oy, dx: rand(-26, 26), dy: -rand(30, 140), rot: rand(-0.5, 0.5), burnAt: 40 - i * 2 }); sfx('swing', 30); });
        for (let i = 0; i < 8; i++) sl(i * 1.5 + 4, () => hit(0.04, 0));
        sl(26, () => { sfx('fire'); popText(ox, oy - 250, L('ボウッ!!', 'FWOOSH!!'), '#5b2a86', 40); finish(0.9, 4); T.curse = Math.max(o.curse || 0, 420); T.curseBy = f; });
        break;
      case 'raincloud':                                      // 鬱：相手の頭上にだけ雨雲がかかり、うずくまる
        addFx('raincloud', ox, oy, { life: 96, ref: landed ? o : null });
        if (landed) T.gloom = 4;
        for (let i = 0; i < 6; i++) sl(6 + i * 3, () => { hit(0.06, 0); if (i % 2 === 0) popText(ox + rand(-30, 30), oy - 170, L('はぁ…', 'sigh…'), '#557', 22); });
        sl(28, () => { finish(0.9, 0); popText(ox, oy - 250, L('もう無理…', "I can't…"), '#557', 34); });
        break;
      case 'unseen': {                                       // 透：姿が完全に消え、見えないまま四方から殴る（殴った跡だけ出る）
        f.invis = 60; popText(ox, oy - 220, L('どこだ!?', 'WHERE?!'), '#555', 32);
        const spots = [[-1, -110], [1, -60], [-1, -150], [1, -120], [-1, -70], [1, -140]];
        spots.forEach(([sd, dy], i) => sl(5 + i * 2.5, () => { const x = ox + sd * 30; addFx('impact', x, oy + dy, { life: 10, size: 70, color: '#e8f4ff' }); addFx('crescent', x, oy + dy, { life: 10, dir: -sd, size: 0.9, rot: rand(-0.6, 0.6), color: '#9ab' }); sfx('hit', 6, w.size); hit(0.07, 0.5); }));
        sl(22, () => { f.invis = 0; f.x = Math.max(40, Math.min(W - 40, ox - (ox >= f.x ? 1 : -1) * -80)); f.facing = ox >= f.x ? 1 : -1; burst(f.x, f.y - 80, '#d8e8ff', 16, 4, null, -0.04); finish(0.8, 14); });
        break;
      }
      case 'cats':                                           // 猫：猫の群れが肉球パンチを連打
        addFx('cats', ox, oy, { life: 66, n: 7 }); popText(ox, oy - 250, L('ニャニャニャ!!', 'MEOW MEOW!!'), '#a66', 34);
        for (let i = 0; i < 10; i++) sl(7 + i * 1.8, () => { addFx('impact', ox + rand(-35, 35), oy - rand(50, 150), { life: 7, size: 44, color: '#ffd0e0' }); if (i % 2 === 0) sfx('hit', 4, 40); hit(0.05, 0.3); });
        sl(27, () => { finish(0.8, 12); popText(ox, oy - 270, L('ニャーン!!', 'MEOWWW!!'), '#a66', 40); });
        break;
      case 'drunkfist': {                                    // 酔：千鳥足でよろけながら連打し、最後に酒瓶が割れる
        const bx = f.x;
        for (let i = 0; i < 7; i++) sl(i * 2.6, () => {
          f.x = Math.max(40, Math.min(W - 40, bx + rand(-24, 24))); f.atk = makeAttack(f, i % 2 ? 'weak' : 'strong'); f.atk.hit = true; f.atk.label = null;
          addFx('impact', ox + rand(-25, 25), oy - rand(60, 140), { life: 8, size: 60, color: '#ffffff' }); sfx('hit', 6, w.size); hit(0.06, 0.6);
          if (i % 3 === 0) popText(f.x, f.y - 190, L(['ヒック', 'うぃ〜', 'もう一杯!'][i / 3 | 0], ['HIC', 'WHEEE~', 'ONE MORE!'][i / 3 | 0]), '#b06', 24);
        });
        sl(18, () => addFx('bottle', ox, oy - 150, { life: 30 }));
        sl(24, () => { sfx('clang'); for (let k = 0; k < 18; k++) spark(ox, oy - 150, k % 2 ? '#3a8a4a' : '#ffffff', 1, 7); finish(0.8, 10); popText(ox, oy - 260, L('パリーン!!', 'SMASH!!'), '#3a8a4a', 40); });
        break;
      }
      case 'gunfire': {                                      // 銃：弾の軌跡と、薬きょうが飛び散る弾幕
        const gx = f.x + f.facing * 60, gy = f.y - 105;
        for (let i = 0; i < 16; i++) sl(i * 1.1, () => {
          addFx('tracer', gx, gy + rand(-6, 6), { life: 5, x2: ox + rand(-20, 20), y2: oy - rand(60, 140) }); addFx('muzzle', gx, gy, { life: 3, d: f.facing });
          particles.push({ x: gx - f.facing * 20, y: gy - 6, vx: -f.facing * rand(2, 5), vy: -rand(4, 7), g: 0.45, life: 40, color: '#d4a020', r: 4 });
          if (i % 2 === 0) sfx('shoot'); hit(0.035, 0.3);
        });
        sl(20, () => { addFx('beam', gx, gy, { life: 20, dir: f.facing }); sfx('boom'); finish(0.8, 14); popText(ox, oy - 260, L('ズドン!!', 'BANG!!'), '#333', 40); });
        break;
      }
      case 'noodlebowl': {                                   // 麺：巨大な丼から麺が伸びてぐるぐる巻きにし、最後にズルズル吸い込む
        const d = ox >= f.x ? 1 : -1, bx = Math.max(90, Math.min(W - 90, f.x - d * 30));
        addFx('bowl', bx, GROUND, { life: 90, d, tx: ox, ty: oy, ref: landed ? o : null });
        popText(bx, GROUND - 230, L('へいお待ち!', 'ORDER UP!'), '#c0392b', 30);
        if (landed) { T.vx = 0; T.bound = Math.max(o.bound || 0, 60); T.boundKind = 'supercoil'; }
        for (let i = 0; i < 4; i++) sl(12 + i * 3, () => hit(0.06, 0));
        sl(26, () => { popText(ox, oy - 250, L('ズルズルズルッ!!', 'SLUUURP!!'), '#c9a36b', 40); if (landed && o.fx !== 'fly') T.vx = -d * 18; sfx('swing', 80); });
        sl(32, () => finish(0.9, 0));
        break;
      }
      // ---- 2026-11 に作り直した必殺技 ----
      case 'prairie':                                        // 草：画面いっぱいに草原が広がり、「草」が地面から次々に生えて笑わせ続ける
        addFx('meadow', ox, GROUND, { life: 110, back: true }); sfx('proc');
        for (let i = 0; i < 14; i++) sl(i * 1.2, () => { const d = (i % 2 ? 1 : -1) * (70 + Math.floor(i / 2) * 75); addFx('sprout', ox + d + rand(-12, 12), GROUND + 4, { life: 92 - i * 2, s: rand(0.8, 1.15), back: true, wshape: i % 3 === 1 }); });
        for (let i = 0; i < 8; i++) sl(4 + i * 2.5, () => { popText(ox + rand(-70, 70), oy - rand(150, 230), 'w'.repeat(3 + (i % 4)), '#2a8a2a', 26 + i * 2); hit(0.06, 0); if (landed) T.laugh = Math.max(o.laugh, 30); });
        sl(24, () => addFx('sprout', ox, GROUND + 4, { life: 50, s: 2.6, pop: true }));
        sl(30, () => { finish(1, 6); m.flash = 3; T.laugh = Math.max(o.laugh || 0, 160); popText(ox, oy - 270, L('大草原!!', 'ROFL!!'), '#2a8a2a', 46); });
        break;
      case 'lightspeed': {                                   // 光：光の線になって画面の左右を何十回も往復し、通るたびに当たる。最後に閃光
        const side = f.x < ox ? -1 : 1; let px = f.x;
        f.invis = 60; sfx('zap');
        for (let i = 0; i < 14; i++) sl(i * 1.2, () => {
          const nx = i % 2 ? 40 : W - 40, y = oy - 90 + rand(-70, 50);
          addFx('lightdash', px, y, { life: 12, x2: nx }); px = nx; f.x = nx; f.invis = Math.max(f.invis, 4);
          if (i % 3 === 0) sfx('zap');
          spark(ox, y, '#fff6c0', 6, 6); hit(0.035, 0);
        });
        sl(19, () => {
          f.invis = 0; f.x = Math.max(40, Math.min(W - 40, ox + side * 100)); f.facing = -side;
          addFx('pillar', ox, oy, { color: '255,245,180', life: 30, wide: 1.6 }); m.flash = Math.max(m.flash, 14);
          finish(1, 10); T.blind = Math.max(o.blind || 0, 120);
        });
        break;
      }
      case 'bigfart': {                                      // 屁：巨大な屁で画面が黄緑に染まり、相手が画面の端まで吹き飛んで激突
        const d = ox >= f.x ? 1 : -1;
        f.buttT = 44;                                        // お尻を相手に向ける（体を半回転して描く）
        popText(f.x, f.y - 210, L('ふんっ…!', 'HNNNGH…!'), '#8a8a3a', 30);
        sl(10, () => {
          popText(f.x, f.y - 230, L('ブッッッ!!!', 'BRRRAAAP!!!'), '#7a8a1a', 60); sfx('boom'); shake = Math.max(shake, 26);
          addFx('tint', W / 2, H / 2, { life: 80, color: '170,200,50', a: 0.4 });
          addFx('cloud', f.x + d * 70, oy - 80, { life: 100, color: '154,170,60', big: true });
          for (let i = 0; i < 40; i++) particles.push({ x: f.x + d * rand(10, 120), y: f.y - rand(20, 120), vx: d * rand(8, 20), vy: rand(-2, 2), g: 0, life: 30, color: 'rgba(150,170,50,0.85)', r: 4, streak: true });
          hit(0.4, null);
          if (landed && o.fx !== 'fly') { T.vx = d * 32; T.vy = -9; T.onGround = false; o.y -= 1; T.wallSlam = 50; T.hitstun = 60; T.stink = 200; }
        });
        sl(26, () => { f.buttT = 0; finish(0.7, null); });
        break;
      }
      case 'fistrush':                                       // 拳：拳の残像が何十本にも見える連打（1発ごとに小さな爆発）。最後は巨大な爆裂パンチ
        for (let i = 0; i < 24; i++) sl(i * 0.9, () => {
          const y = oy - rand(50, 150);
          addFx('fistline', f.x + f.facing * rand(10, 50), y + rand(-25, 25), { life: 7, x2: ox - f.facing * 15, y2: y, side: f.side });
          addFx('explosion', ox + rand(-25, 25), y, { life: 12, r: 36 });
          if (i % 2 === 0) { sfx('hit', 6, w.size); hit(0.025, 0.4); }
        });
        sl(23, () => addFx('bigfist', ox - f.facing * 420, oy - 100, { life: 18, x2: ox - f.facing * 40, d: f.facing, side: f.side }));
        sl(28, () => { addFx('explosion', ox, oy - 90, { life: 46, r: 210 }); sfx('boom'); popText(ox, oy - 260, L('ドカーン!!', 'KABOOM!!'), '#e30', 48); finish(0.9, 26); });
        break;
      case 'bees':                                           // 蜂：画面の左右から蜂の大群が飛んできて、相手にたかって刺す
        addFx('bees', ox, oy - 90, { life: 70, n: 36, ref: landed ? o : null });
        popText(ox, oy - 250, L('ブブブブブ…', 'BZZZZZZ…'), '#c89a00', 34); sfx('zap');
        for (let i = 0; i < 10; i++) sl(8 + i * 2, () => { hit(0.05, 0); if (i % 2 === 0) popText(ox + rand(-60, 60), oy - rand(100, 170), L('チクッ', 'STING'), '#c80', 20); });
        sl(30, () => { finish(0.8, 8); popText(ox, oy - 260, L('ブスッ!!', 'STAB!!'), '#c00', 44); T.stings = 0; });
        break;
      case 'shadowclone': {                                  // 影：プレイヤーと瓜二つの黒い影分身が現れて、一斉に殴りかかる
        popText(f.x, f.y - 220, L('影分身!!', 'SHADOW CLONES!!'), '#222', 34);
        [-190, 190, f.x < ox ? -330 : 330].forEach((dx, i) => {
          const sx = Math.max(40, Math.min(W - 40, ox + dx)), dir = sx < ox ? 1 : -1;
          sl(i * 3, () => { addFx('shadowclone', sx, GROUND, { life: 42 - i * 3, f, tx: ox - dir * 70, d: dir }); burst(sx, GROUND - 80, '#1a1a22', 16, 4, null, -0.03); sfx('swing', 60); });
        });
        for (let i = 0; i < 6; i++) sl(11 + i * 2.5, () => { addFx('crescent', ox + rand(-20, 20), oy - rand(60, 120), { life: 10, dir: i % 2 ? -1 : 1, size: 1.1, rot: rand(-0.6, 0.6), color: '#222' }); sfx('slash'); hit(0.07, 1); });
        sl(28, () => finish(0.8, 14));
        break;
      }
      case 'phantom': {                                      // 幻：半透明の自分が輪になって現れ全員から字が飛ぶ → 空間が歪み、巨大な幻の字が相手を飲み込む
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU + 0.3, px = ox + Math.cos(a) * 210, py = oy - 10 - (Math.sin(a) + 1) * 80;
          sl(i * 1.2, () => addFx('phantomself', px, py, { life: 46 - i, f, d: px < ox ? 1 : -1 }));
          sl(10 + i * 2, () => addFx('clone', ox, oy - 90, { life: 14, a, w }));
          sl(15 + i * 2, () => { sfx('hit', 6, w.size); hit(0.05, 0.5); addFx('impact', ox + rand(-30, 30), oy - rand(60, 120), { life: 8, size: 60, color: '#e8d8ff' }); });
        }
        sl(29, () => { addFx('warp', ox, oy - 90, { life: 74 }); sfx('ice'); popText(ox, oy - 250, L('ゆら…ゆら…', 'WOBBLE… WOBBLE…'), '#7a5ab0', 30); });
        sl(35, () => addFx('phantomglyph', ox, oy - 90, { life: 40, w }));
        sl(50, () => { finish(0.9, 6); T.confused = Math.max(o.confused || 0, 90); });
        break;
      }
      case 'pinball': {                                      // 跳：壁と天井をピンボールのように跳ね回り、通るたびに当たる
        const d = ox >= f.x ? 1 : -1, cl = (x) => Math.max(50, Math.min(W - 50, x)), far = cl(ox + d * 300), near = cl(ox - d * 280), hy = oy - 90, TOP = 150;   // 画面から出ないよう、相手のまわりで跳ね回る
        const P = [[f.x, f.y - 60, 0], [ox, hy, 1], [far, 210, 2], [(ox + far) / 2, TOP, 2], [near, 250, 2], [ox, hy, 1], [far, 120, 2], [ox - d * 120, TOP, 2],
          [near, 170, 2], [ox, hy, 1], [far, 290, 2], [(ox + near) / 2, TOP, 2], [ox, hy, 1], [ox - d * 95, GROUND, 3]];
        const SEG = 3;
        for (let j = 1; j < P.length; j++) for (let k = 1; k <= SEG; k++) {
          f.later(8 + (j - 1) * SEG + k, () => {
            const [x0, y0] = P[j - 1], [x1, y1, kind] = P[j], q = k / SEG;
            f.x = x0 + (x1 - x0) * q; f.y = Math.min(GROUND, y0 + (y1 - y0) * q); f.vx = 0; f.vy = 0; f.onGround = f.y >= GROUND;
            for (let i = 0; i < 3; i++) particles.push({ x: f.x - 20 + rand(-30, 30), y: f.y - 60 + rand(-40, 40), vx: 0, vy: 0, g: 0, life: 10, color: 'rgba(255,220,120,0.85)', r: 2, streak: true });
            if (k < SEG) return;
            if (kind === 1) { addFx('impact', ox, hy, { life: 10, size: 90, color: '#fff6c0' }); sfx('hit', 8, w.size); hit(0.1, 0); }
            if (kind === 2) { spark(f.x, f.y - 60, '#ffffff', 10, 5); popText(f.x, f.y - 120, L('ボヨン', 'BOING'), '#c60', 20); shake = Math.max(shake, 6); sfx('hit', 3, 40); }
            if (kind === 3) { f.facing = d; shake = Math.max(shake, 16); spark(f.x, GROUND - 6, '#c9a36b', 20, 7); cracks.push({ x: f.x, life: 90, seed: Math.random() * 1000 }); finish(0.8, 14); }
          });
        }
        break;
      }
      case 'meteor':                                         // 星：夜空に変わり、尾を引く大きな流れ星が次々に降ってきて、着弾で爆発
        addFx('nightsky', W / 2, 0, { life: 62, back: true });
        for (let i = 0; i < 9; i++) {
          sl(4 + i * 2.2, () => addFx('meteor', ox + rand(-140, 140), GROUND - 10, { life: 20, from: -f.facing, s: rand(0.7, 1.1) }));
          sl(9.6 + i * 2.2, () => { if (i % 2 === 0) sfx('boom'); shake = Math.max(shake, 7); hit(0.05, 0.5); });
        }
        sl(25, () => addFx('meteor', ox, oy - 40, { life: 26, from: -f.facing, s: 2.6, final: true }));
        sl(31, () => { finish(1, 8); T.dizzy = 40; });
        break;
      case 'serpent':                                        // 蛇：地面から巨大な大蛇が現れ、相手に巻きついて締め上げ、最後に噛みつく
        addFx('serpent', ox, GROUND, { life: 84, ref: landed ? o : null, side: ox >= f.x ? 1 : -1 }); sfx('boom'); shake = Math.max(shake, 10);
        if (landed) { T.vx = 0; T.bound = Math.max(o.bound || 0, 72); T.boundKind = 'supercoil'; }
        for (let i = 0; i < 4; i++) sl(14 + i * 4, () => { shake = Math.max(shake, 5 + i * 3); popText(ox + rand(-30, 30), oy - 200 - i * 8, L('ギュウ…', 'SQUEEZE…'), '#2a6a2a', 22 + i * 3); sfx('guard'); hit(0.07, 0); });
        sl(33, () => { addFx('teeth', ox, oy - 130, { life: 30, big: true }); sfx('slash'); finish(1.1, 0); popText(ox, oy - 260, L('ガブッ!!', 'CHOMP!!'), '#2a6a2a', 46); });
        break;
      case 'lawbook':                                        // 法：巨大な六法全書が上から落ちてきて押しつぶす
        popText(f.x, f.y - 220, L('判決を言い渡す!', 'THE COURT RULES!'), '#2a3a6a', 30);
        sl(6, () => addFx('bigobj', ox, oy - 40, { life: 56, obj: 'lawbook', s: 5, rot: -0.06 }));
        sl(14, () => {
          finish(1.2, 4); popText(ox, oy - 270, L('有罪!!', 'GUILTY!!'), '#c0392b', 52);
          if (o.fx !== 'fly') { T.squash = 60; T.down = 60; T.downMax = 60; }
          cracks.push({ x: ox - 60, life: 120, seed: Math.random() * 1000 }); cracks.push({ x: ox + 60, life: 120, seed: Math.random() * 1000 });
        });
        break;
      case 'shuriken':                                       // 忍：手から手裏剣を次々に投げ、最後に巨大な手裏剣
        for (let i = 0; i < 12; i++) sl(i * 1.4, () => {
          const y0 = f.y - rand(90, 130);
          addFx('shurikenfly', f.x + f.facing * 30, y0, { life: 12, x2: ox + rand(-20, 20), y2: oy - rand(50, 140) }); sfx('shoot');
        });
        for (let i = 0; i < 12; i++) sl(i * 1.4 + 4, () => { if (i % 2 === 0) sfx('slash'); spark(ox + rand(-25, 25), oy - rand(50, 140), '#cfd6e0', 4, 4); hit(0.04, 0.3); });
        sl(19, () => { popText(f.x, f.y - 220, L('奥義・大手裏剣!!', 'GIANT SHURIKEN!!'), '#334', 32); addFx('shurikenfly', f.x + f.facing * 40, f.y - 130, { life: 18, x2: ox, y2: oy - 100, big: true }); sfx('swing', 150); });
        sl(25, () => { addFx('crescent', ox, oy - 90, { life: 22, dir: f.facing, size: 2.4, rot: 0, flat: true }); finish(0.9, 18); });
        break;
      case 'fastball':                                       // 球：振りかぶって、炎をまとった剛速球を投げる
        popText(f.x, f.y - 220, L('振りかぶって…', 'THE WIND-UP…'), '#555', 28);
        f.atk = makeAttack(f, 'strong'); f.atk.hit = true; f.atk.label = null; f.atk.su = 10; f.atk.act = 14;
        f.thrownSuper = 4; for (let i = 0; i < 8; i++) sl(i * 0.8, () => { spark(f.x + f.facing * 30, f.y - 200, '#ff8a1f', 4, 2, { g: -0.08 }); });   // 振りかぶると字が燃え上がる
        sl(7, () => { f.thrownSuper = 60; addFx('fireball', f.x + f.facing * 40, f.y - 120, { life: 10, tx: ox, ty: oy - 90, w }); sfx('fire'); sfx('swing', 120); });
        sl(13, () => { addFx('explosion', ox, oy - 90, { life: 46, r: 200 }); sfx('boom'); finish(1.2, 26); T.burn = Math.max(o.burn || 0, 200); T.burnBy = w.ch; });
        break;
      case 'negi':                                           // 母：ネギが千本降り注ぎ、最後に特大のネギが突き刺さる
        for (let i = 0; i < 30; i++) sl(i * 0.7, () => addFx('fallobj', ox + rand(-150, 150), GROUND - rand(4, 30), { life: 34, obj: 'negi', rot: rand(-0.5, 0.5) }));
        for (let i = 0; i < 8; i++) sl(8 + i * 2, () => { if (i % 2 === 0) sfx('hit', 5, w.size); hit(0.05, 0.5); });
        sl(26, () => { addFx('bigobj', ox, oy - 70, { life: 46, obj: 'negi', s: 5, rot: 0.25 }); popText(ox, oy - 260, L('早く寝なさい!!', 'GO TO BED!!'), '#c0392b', 40); });
        sl(32, () => { finish(0.9, 6); if (o.fx !== 'fly') { T.down = 50; T.downMax = 50; } });
        break;
      case 'muscle':                                         // 筋：ダンベルが降り注ぎ、最後に巨大バーベル
        for (let i = 0; i < 22; i++) sl(i * 0.9, () => addFx('fallobj', ox + rand(-140, 140), GROUND - rand(6, 20), { life: 34, obj: 'dumbbell', rot: rand(-0.3, 0.3) }));
        for (let i = 0; i < 7; i++) sl(8 + i * 2.5, () => { sfx('clang'); hit(0.06, 0.5); });
        sl(26, () => { addFx('bigobj', ox, oy - 60, { life: 46, obj: 'dumbbell', s: 6, rot: 0 }); popText(ox, oy - 260, L('キレてる!!', 'SHREDDED!!'), '#c0392b', 44); });
        sl(32, () => { finish(1, 4); if (o.fx !== 'fly') { T.squash = 50; T.down = 50; T.downMax = 50; } cracks.push({ x: ox, life: 90, seed: Math.random() * 1000 }); });
        break;
      case 'sushi':                                          // 鮨：いろいろな寿司が降り注ぎ、最後に相手が巨大な握り寿司にされる
        for (let i = 0; i < 30; i++) sl(i * 0.7, () => addFx('fallobj', ox + rand(-150, 150), GROUND - rand(4, 16), { life: 34, obj: 'sushi', neta: SUSHI_NETA[i % SUSHI_NETA.length], rot: rand(-0.4, 0.4) }));
        for (let i = 0; i < 8; i++) sl(8 + i * 2, () => { if (i % 2 === 0) sfx('slap'); hit(0.05, 0.5); });
        sl(26, () => { addFx('nigiri', ox, oy, { life: 110, ref: landed ? o : null }); if (landed) { T.vx = 0; T.bound = Math.max(o.bound || 0, 100); T.boundKind = 'nigiri'; } });
        sl(36, () => { finish(1.1, 0); popText(ox, oy - 250, L('特上一丁!!', 'ONE DELUXE, COMING UP!!'), '#c0392b', 40); });
        break;
      case 'tax':                                            // 税：請求書が雪崩のように降り、最後に巨大な「増税」の判子
        for (let i = 0; i < 34; i++) sl(i * 0.6, () => addFx('fallobj', ox + rand(-130, 130), GROUND - rand(4, 40), { life: 40, obj: 'bill', rot: rand(-0.8, 0.8) }));
        for (let i = 0; i < 7; i++) sl(8 + i * 2.5, () => { if (i % 2 === 0) sfx('slap'); hit(0.05, 0.5); });
        sl(26, () => addFx('hanko', ox, oy - 110, { life: 56 }));
        sl(30, () => { finish(1, 6); T.tax = Math.max(o.tax || 0, 600); sfx('clang'); });
        break;
      case 'punish':                                         // 罰：空が割れ、小さな天罰の雷が何本も落ちたあと、特大の雷が1本
        addFx('skycrack', ox, 0, { life: 80 }); sfx('clang');
        for (let i = 0; i < 6; i++) sl(6 + i * 2.5, () => { addFx('bolt', ox + rand(-90, 90), oy - 80, { life: 12 }); sfx('zap'); hit(0.05, 0); });
        sl(24, () => { addFx('bolt', ox, oy - 80, { life: 20, big: true }); m.flash = Math.max(m.flash, 12); finish(1.15, 4); T.stunned = Math.max(o.stunned, 60); });
        break;
      case 'evil':                                           // 悪：暗くなって高笑い、黒い稲妻、最後に背後から一撃
        addFx('vignette', ox, oy - 90, { life: 70, color: '20,0,25' });   // 画面全体は暗くしない（白く光ったときにグレーに見えるので）
        popText(f.x, f.y - 230, L('フハハハハ!!', 'MWAHAHAHA!!'), '#5a1a6a', 40); sfx('vs');
        for (let i = 0; i < 5; i++) sl(5 + i * 3, () => { addFx('bolt', ox + rand(-90, 90), oy - 80, { life: 12, dark: true }); sfx('zap'); hit(0.05, 0); });
        sl(22, () => {
          const from = f.x; f.x = Math.max(40, Math.min(W - 40, o.x + (f.x < o.x ? 70 : -70))); f.facing = o.x >= f.x ? 1 : -1;
          for (let j = 0; j < 14; j++) particles.push({ x: from + (f.x - from) * Math.random(), y: f.y - rand(20, 150), vx: 0, vy: 0, g: 0, life: 14, color: 'rgba(90,20,110,0.85)', r: 2, streak: true });
          addFx('crescent', ox, oy - 90, { life: 20, dir: f.facing, size: 2.2, rot: 0, flat: true, color: '#7a2a9a' }); sfx('slash');
        });
        sl(25, () => finish(1, 16));
        break;
      case 'souls':                                          // 魂：青い人魂の大群が渦を巻いて突撃
        for (let i = 0; i < 26; i++) sl(i * 0.8, () => addFx('wisp', f.x + rand(-50, 50), f.y - rand(40, 200), { life: 30, tx: ox, ty: oy - 100, a0: rand(0, TAU) }));
        for (let i = 0; i < 8; i++) sl(10 + i * 2.5, () => { if (i % 2 === 0) sfx('fire'); hit(0.06, 0.5); });
        sl(34, () => { addFx('ring', ox, oy - 100, { color: '#7ac8ff', life: 24, big: true }); finish(0.9, 10); m.flash = 3; });   // 人魂の光が重なるので、白い光は弱く
        break;
      case 'otsu': {                                         // 乙：17時のチャイム。「お疲れ様でした〜」と高速で何度も駆け抜ける
        addFx('clock5', (f.x + ox) / 2, oy - 300, { life: 80 }); sfx('temple');
        popText((f.x + ox) / 2, oy - 210, L('キーンコーンカーンコーン♪', 'DING DONG DING DONG♪'), '#557', 26);
        const pass = (i) => {
          const from = f.x, to = Math.max(40, Math.min(W - 40, o.x + (f.x < o.x ? 120 : -120)));
          f.x = to; f.facing = to > from ? 1 : -1;
          for (let j = 0; j < 16; j++) particles.push({ x: from + (to - from) * Math.random(), y: f.y - rand(10, 160), vx: f.facing * 6, vy: 0, g: 0, life: 16, color: 'rgba(255,255,255,0.85)', r: 2, streak: true });
          spark(f.x, f.y - 4, '#c9a36b', 8, 3); sfx('swing', w.size * 2); hit(0.12, 2);
          if (i === 0) popText(f.x, f.y - 200, L('お疲れ様でした〜', 'Good work today~'), '#557', 30);
        };
        for (let i = 0; i < 4; i++) sl(16 + i * 4, () => pass(i));
        sl(34, () => { finish(0.7, 14); popText(f.x, f.y - 220, L('お先に失礼します', 'I\'m heading out!'), '#557', 26); });
        break;
      }
      case 'reaper': {                                       // 鎌：背後に死神の影、巨大な鎌が画面を横切る（弱った相手は刈り取り）
        const weak = o.hp <= 30;
        addFx('reaper', ox, oy, { life: 64, dir: f.facing }); addFx('vignette', ox, oy - 90, { life: 60, color: '20,0,25' });
        sl(16, () => { sfx('slash'); addFx('crescent', ox, oy - 90, { life: 22, dir: f.facing, size: 3, rot: 0, flat: true, color: '#5a1a6a' }); });
        sl(18, () => { finish(weak ? 2 : 1, 12); if (weak && landed) popText(ox, oy - 250, L('刈り取り!!', 'REAPED!!'), '#3a1a4a', 48); });
        break;
      }
      case 'ghosts':                                         // 霊：お化けの行列が相手を通り抜け、通るたびにダメージ
        addFx('vignette', ox, oy - 90, { life: 80, color: '20,30,60' });
        addFx('parade', ox, oy, { life: 70, dir: f.facing }); popText(ox, oy - 230, L('うらめしや〜', 'BOOOO~'), '#7a8aa8', 32);
        for (let i = 0; i < 7; i++) sl(6 + i * 3, () => { hit(0.07, 0); spark(ox, oy - rand(40, 140), '#c8d8ff', 4, 2); });
        sl(30, () => { finish(0.8, 6); T.stunned = Math.max(o.stunned, 40); });
        break;
      case 'kickshot':                                       // 蹴：字を足もとに落とし、蹴り上げ、落ちてきたところを燃えるシュートで相手へ
        f.vx = 0; f.thrownSuper = 60; f.kickT = KICK_LEN;      // 1回目：蹴り上げ（8フレーム目で足が当たる）
        addFx('kickball', f.x + f.facing * 64, f.y, { life: 40, tx: ox, ty: oy - 90, w, dir: f.facing, fx0: f.x });
        f.later(8, () => { sfx('swing', w.size); addFx('crescent', f.x + f.facing * 40, f.y - 40, { life: 10, dir: f.facing, size: 1, rot: -0.9 * f.facing, color: '#ffe680' }); });
        f.later(16, () => { f.kickT = KICK_LEN; popText(f.x, f.y - 220, L('必殺シュート!!', 'SUPER SHOT!!'), '#e40', 34); });   // 2回目：落ちてきた字をボレー
        f.later(24, () => { sfx('fire'); shake = Math.max(shake, 10); addFx('crescent', f.x + f.facing * 46, f.y - 60, { life: 14, dir: f.facing, size: 1.6, rot: -0.4 * f.facing, color: '#ff8a1f' }); addFx('beam', f.x, oy - 90, { life: 18, dir: f.facing }); });
        f.later(31, () => { finish(1.15, 22); T.burn = Math.max(o.burn, 200); T.burnBy = w.ch; });
        break;
      default:                                               // drop：巨大な字が空から落ちてくる
        addFx('bigdrop', ox, oy, { life: 46, w });
        sl(14, () => { finish(1.1, 4); if (o.fx !== 'fly') { T.squash = 50; T.down = 50; T.downMax = 50; } cracks.push({ x: ox, life: 90, seed: Math.random() * 1000 }); });
    }
    f.st.procs++;
  }

  // ---------- AI（両者とも同じAIで自動で戦う）----------
  // 重みつきでひとつ選ぶ
  function pickWeighted(list) {
    let sum = 0; for (const [, w] of list) sum += w;
    let r = Math.random() * sum;
    for (const [k, w] of list) { if ((r -= w) <= 0) return k; }
    return list[0][0];
  }
  let moveSeq = 0;
  class Ai {
    constructor() { this.plan = { ...NO_INPUT }; this.left = 20; }
    hold(inp, frames) { this.plan = { ...NO_INPUT, ...inp }; this.left = frames; }
    use(move, frames) { this.hold({ move, moveSeq: ++moveSeq }, frames || 2); }
    think(me, opp) {
      if (this.left-- > 0) return this.plan;
      const w = me.weapon, reach = me.reach();
      const dist = Math.abs(opp.x - me.x);
      const toward = opp.x > me.x ? 'right' : 'left', away = toward === 'right' ? 'left' : 'right';
      const r = Math.random();
      const oa = opp.atk;
      // こう着防止：8秒間どちらにもダメージが入っていなければ、とにかく前に出て殴る
      const stall = match && match.phase === 'fight' && match.frame - (match.lastDmg || 0) > 480;
      if (stall && !(oa && oa.t < oa.su + oa.act)) {
        if (dist > reach * 0.85) this.hold({ [opp.x > me.x ? 'right' : 'left']: true }, 10);
        else if (!me.atk) this.use(r < 0.6 ? 'weak' : 'sweep');
        else this.hold({}, 4);
        this.left += 4;
        return this.plan;
      }
      const threat = oa && oa.t < oa.su + oa.act && dist < opp.reach() + 40;
      const cornered = me.x < 90 || me.x > W - 90;
      const oppAir = opp.y < GROUND - 50 && opp.fx !== 'fly';
      const canJump = me.canJump();
      const light = w.startup + w.recovery < 22;            // 出が速い字は手数で攻める

      if (!me.onGround && canJump && !me.atk && (me.fx !== 'hop' || r < 0.4)) {
        // 空中にいて届きそうならジャンプ攻撃
        if (dist < reach + 50) this.use('jump'); else this.hold({ [toward]: true }, 4);
      } else if (threat) {
        if (oa.low && canJump && r < 0.55) this.hold({ up: true, [away]: true }, 10);        // 足払いは跳んでよける
        else if (r < 0.35) this.hold({ guard: true }, 22);
        else if (r < 0.5 && canJump && !cornered) this.use('backstep', 10);
        else if (r < 0.65 && oa.name === 'weak') this.hold({ down: true }, 18);
        else if (r < 0.78) this.hold({ [away]: true }, 14);
        else this.hold({}, 8);
      } else if (oppAir && !opp.untouchable() && dist < reach * 1.15 && !me.atk && r < 0.55) {
        this.use('anti');                                                                      // 跳んできた相手を迎え撃つ
      } else if (w.effect === 'love' && dist < 220 && !cornered && r < 0.4) {
        this.hold({ [away]: true }, 18);                                                       // 恋：照れて逃げ回る
      } else if (w.ranged) {
        // 飛び道具持ちは距離を取って撃つ
        if (dist < 150 && !cornered && r < 0.35) this.use(r < 0.15 ? 'backstep' : 'weak', 10);
        else if (dist < reach * 0.9 && r < 0.5) this.use(w.signature && r < 0.3 ? w.signature : 'sweep');
        else if (!me.atk) { this.use('weak'); this.left += 6; }   // 撃ったあとは少し間を空ける
        else this.hold({}, 4);
      } else if (opp.untouchable()) {
        this.hold(dist < reach * 0.7 ? { [away]: true } : {}, 10);                            // 起き上がりを待つ
      } else if (dist > reach * 0.85) {
        if (w.effect === 'iai' && r < 0.8 && me.t < 900) this.hold({}, 14);                   // 侍：じっと構えて待つ
        else if (dist < reach + 170 && r < 0.2) this.use('dash');
        else if (canJump && dist < reach + 230 && r < 0.3) this.hold({ up: true, [toward]: true }, 8);   // 跳び込み
        else this.hold({ [toward]: true }, 12 + Math.random() * 10);
      } else if (!me.atk && me.gloom > 0 && r < me.gloom * 0.06) {
        this.hold({}, 24);                                                                    // 鬱：やる気が出ない
        if (Math.random() < 0.3) popText(me.x, me.y - 165, '…はぁ', '#557', 20);
      } else if (!me.atk && w.effect === 'iai') {
        this.use('weak');                                                                     // 侍：間合いに入ったら居合
      } else if (!me.atk) {
        const sig = w.signature, tr = w.traits || {};
        const move = pickWeighted([
          ['weak', light ? 34 : 18], ['strong', (light ? 8 : 16) + (tr.flat ? 8 : 0)], ['sweep', 12 + (tr.hook ? 6 : 0)], ['spin', light ? 3 : 7],
          [sig || 'strong', sig ? 22 : 4], ['backstep', 5], ['guard', 7 + (tr.hole ? 6 : 0)], ['hopin', canJump ? 6 : 0],
        ]);
        if (move === 'guard') this.hold({ guard: true }, 16);
        else if (move === 'hopin') this.hold({ up: true, [toward]: true }, 8);
        else if (move === 'strong') this.hold({ strong: true, move: 'strong', moveSeq: ++moveSeq }, 2 + Math.random() * 30);  // 溜めあり
        else this.use(move);
      } else this.hold({}, 4);
      this.left += 10 + Math.random() * 12; // 反応の遅れ（短いと次々に技が出て、何が起きたか分からない）
      return this.plan;
    }
  }

  // ---------- 試合 ----------
  let match = null;
  // 遊び方：cpu（ふつう）/ versus（その場で2人対戦）
  //   survival（勝ち抜き：負けたら終わり）
  const mode = { kind: 'cpu', p1: null, p2: null, step: 1 };
  let run = null;                         // 勝ち抜きの途中経過 { wins, hp }
  // 勝ち抜きの相手：1人ごとに画数が増えていく。5人目・10人目…は特別な字（ボス）
  const RIVAL_POOL = [...'山川口弓土木牛月王石田目皿矢玉竹米肉耳羊虫舟車貝角豆足麦雨虎金門岩林首星草春馬骨剣紙酒魚鳥船黒釣森雲椅道象電鉄腹塩蓋髪鼻銀獄歌熊鋼線箱槍橋機頭薬鍋鮭鍵翼顔職騎鎧鯉鏡鯨蟹霧議鐘騰響鶴鰯艦轟鷗驚襲籠鷲鑑鱗鷹鱶鬢鬣驢鑽鱸鑿鸚鬱驪鸞驫籲麤鱻齉靐䨻']
    .filter((c) => !Weapon.isSpecial(c));
  let rivalStrokes = null, lastRival = null;
  const isBoss = (k) => (k + 1) % 5 === 0;      // k = それまでの勝ち数
  // 勝ち抜きの難しさ（10連勝できる確率がだいたい5%になるように、自動対戦で合わせた）
  //   toughBase：最初の相手の打たれ強さ（1より小さいと、こちらの攻撃がよく効く）、toughStep：1勝ごとに相手が打たれ強くなる割合、toughMax：その上限、bossTough：ボスの打たれ強さの倍率、strokeStep：1勝ごとに増える相手の画数
  const SURV = { toughBase: 0.6, toughStep: 0.02, toughMax: 2.5, bossTough: 1.1, strokeStep: 1.9 };
  function survivalRival(k) {                // 同じ相手が2回続かないようにする
    let ch, tries = 0;
    do ch = pickRival(k); while (ch === lastRival && ++tries < 8);
    return (lastRival = ch);
  }
  function pickRival(k) {
    if (isBoss(k)) {
      const sp = [...Weapon.SPECIAL_LIST, '龍'].filter((c) => Weapon.isSpecial(c) || c === '龍');
      return sp[Math.floor(Math.random() * sp.length)];
    }
    if (!rivalStrokes) rivalStrokes = RIVAL_POOL.map((c) => [c, Weapon.make(c).strokes]).sort((a, b) => a[1] - b[1]);
    const top = rivalStrokes[rivalStrokes.length - 1][1];
    const lo = Math.min(2 + SURV.strokeStep * k, top - 8), hi = lo + 5;     // 1人目は2〜7画から、1勝ごとに画数が増える
    let pool = rivalStrokes.filter((a) => a[1] >= lo && a[1] <= hi);
    if (pool.length < 3) pool = rivalStrokes.slice(-6);
    return pool[Math.floor(Math.random() * pool.length)][0];
  }
  const sideNames = () => (mode.kind === 'versus' ? ['1P', '2P'] : [L('あなた', 'YOU'), 'CPU']);
  function startMatch(playerCh, cpuCh) {
    lastPlayerCh = playerCh;
    match = {
      kind: mode.kind, names: sideNames(),
      p: new Fighter(0, Weapon.make(playerCh)),
      c: new Fighter(1, Weapon.make(cpuCh || Weapon.randomForCpu())),
      ai: [new Ai(), new Ai()], phase: 'intro', phaseT: 0, timer: ROUND_FRAMES, banner: '', frame: 0,
      wind: 0, flash: 0, dark: 0,
    };
    if (mode.kind === 'survival' && run) {           // 勝ち抜き：HPは前の試合から持ち越し、相手は打たれ強くなる
      match.stage = run.wins;
      match.p.hp = run.hp;
      match.c.tough = Math.min(SURV.toughMax, SURV.toughBase + SURV.toughStep * run.wins) * (isBoss(run.wins) ? SURV.bossTough : 1);
      match.boss = isBoss(run.wins);
    }
    particles = []; texts = []; projectiles = []; traps = []; cracks = []; swamps = []; stinks = []; fxs = []; smites = []; shake = 0; hitstop = 0; punch = 0;
    updateCamera(match, true);
    showScreen(null);
    if (window.Bgm) Bgm.play('battle');
  }
  function endRound() {
    const { p, c } = match;
    let winner = -1;
    if (p.hp > c.hp) winner = 0; else if (c.hp > p.hp) winner = 1;
    const loser = winner === 0 ? c : p;
    if (match.timer <= 0) match.banner = winner < 0 ? L('時間切れ…', 'TIME UP…') : L('時間切れ!', 'TIME UP!');
    else if (match.void) match.banner = L('無の境地…', 'ZEN…');
    else if (winner < 0) match.banner = L('相打ち!', 'DOUBLE KO!');
    else { const by = loser.lastHitBy || (winner === 0 ? p : c).weapon.ch; match.banner = L(`『${by}』でKO!`, `KO BY ${by}!`); match.koBy = by; }
    match.winner = winner;
    if (winner >= 0) (winner === 0 ? c : p).dust = 1;   // 負けた字は砂になって消える
    match.phase = 'ko'; match.phaseT = 0;
    match.dark = 0; match.superSlow = 0; match.charge = null; match.superName = null;
    match.p.giant = match.c.giant = 1;
    // 結果カードの文字のフォントを、KO演出のあいだに読み込んでおく
    Texture.preload(resultOf(match).headline + L('漢字ファイター勝利敗北引分きけVS#!…1P2Pの勝ち連勝0123456789', 'KANJIFGHTERVSWINLOSDAW#!…0123456789'));
    // KOなら倒れた側に寄ってスロー。時間切れは寄らない
    if (match.timer > 0 && winner >= 0) {
      match.koFocus = { x: loser.x, y: loser.y - 90 }; match.koLoser = loser;
      match.koFlash = 10; shake = 30; punch = 0.3;
      // 最後の一撃：大きな光と衝撃の輪、火花
      addFx('impact', loser.x, loser.y - 90, { life: 22, size: 230, color: '#fff6c0' });
      addFx('ring', loser.x, loser.y - 90, { color: '#ffffff', life: 26, big: true });
      spark(loser.x, loser.y - 90, '#ffd84d', 50, 14); spark(loser.x, loser.y - 90, '#ffffff', 30, 10);
      sfx('ko');
    } else sfx('timeup');
    if (window.Bgm) Bgm.stop(0.8);
  }

  // ---------- 勝因・敗因 ----------
  function verdict(m) {
    const { p, c } = m, w = m.winner;
    const hp = (f) => Math.ceil(f.hp);
    if (w < 0) return { head: L('引き分け', 'Draw'), body: L(`残りHP ${hp(p)} 対 ${hp(c)}。まったくの互角でした`, `HP left: ${hp(p)} vs ${hp(c)}. A perfect tie`) };
    const win = w === 0 ? p : c, lose = w === 0 ? c : p;
    const W1 = win.weapon, L1 = lose.weapon, d = W1.strokes - L1.strokes;
    const eff = win.st.dealt - win.st.direct;
    const cand = [[10, L(`『${W1.ch}』の手数が上回った（${win.st.hits}発 対 ${lose.st.hits}発）`, `${W1.ch} simply hit more (${win.st.hits} hits vs ${lose.st.hits})`)]];
    if (win.fx === 'nothing') cand.push([100, L(`『無』が勝った。虚無の勝利`, `無 (nothingness) won. A victory of the void`)]);
    if (lose.st.naps >= 3) cand.push([90, L(`『${L1.ch}』が${lose.st.naps}回サボった`, `${L1.ch} slacked off ${lose.st.naps} times`)]);
    if (lose.st.kyo >= 2) cand.push([85, L(`『運』のおみくじで凶が${lose.st.kyo}回`, `運 drew BAD LUCK ${lose.st.kyo} times`)]);
    if (lose.st.misses >= 3) cand.push([80, L(`『${L1.ch}』が目がくらんで${lose.st.misses}回スカった`, `${L1.ch} was blinded and whiffed ${lose.st.misses} times`)]);
    if (m.timer <= 0) cand.push([70, L(`時間切れ判定。残りHP『${W1.ch}』${hp(win)} 対『${L1.ch}』${hp(lose)}`, `Time up. HP left: ${W1.ch} ${hp(win)} vs ${L1.ch} ${hp(lose)}`)]);
    if (W1.effect && (eff >= 20 || win.st.procs >= 4)) cand.push([60 + win.st.procs, L(`『${W1.ch}』の${EFFECT_NAME[W1.effect] || '効果'}が決め手` + (win.st.procs > 0 ? `（${win.st.procs}回発動）` : ''), `${W1.ch}'s ${effectName(W1.effect) || 'effect'} sealed the deal` + (win.st.procs > 0 ? ` (triggered ${win.st.procs}x)` : ''))]);
    if (win.st.best >= 25) cand.push([55, L(`『${W1.ch}』の一撃${Math.round(win.st.best)}ダメージの大技が決まった`, `${W1.ch} landed a monster ${Math.round(win.st.best)}-damage hit`)]);
    if (d >= 8) cand.push([50, L(`『${W1.ch}』${W1.strokes}画の大きさとリーチで、${L1.strokes}画の『${L1.ch}』を押し切った`, `${W1.ch}'s ${W1.strokes} strokes of size and reach crushed ${L1.ch} (${L1.strokes} strokes)`)]);
    if (d <= -8) cand.push([50, L(`『${W1.ch}』${W1.strokes}画の身軽さで手数勝ち（${win.st.hits}発）`, `${W1.ch} (${W1.strokes} strokes) was light and fast (${win.st.hits} hits)`)]);
    cand.sort((a, b) => b[0] - a[0]);
    return { head: w === 0 || m.kind === 'versus' ? L('勝因', 'Why you won') : L('敗因', 'Why you lost'), body: cand[0][1] };
  }

  function step() {
    const m = match;
    // 必殺技のカットイン中は、時間が止まる
    if (m.cutin) {
      if (++m.cutin.t >= CUT_LEN) { m.charge = { c: m.cutin, t: 0 }; m.cutin = null; sfx('gauge'); }
      return;
    }
    // 必殺技の技が出ている間は、ゆっくり（半分の速さ）
    if (m.superSlow > 0) { m.superSlow--; if (m.superSlow % 2) return; }
    m.frame++;
    punch *= 0.86;
    for (const pt of particles) {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += pt.g; pt.life--;
      if (pt.coin) { pt.spin += 0.35; if (pt.bounce && pt.y > GROUND - 6 && pt.vy > 0) { pt.y = GROUND - 6; pt.vy *= -0.45; pt.vx *= 0.7; } }
      if (pt.bill || pt.petal) { pt.rot += pt.vr; pt.vx = pt.vx * 0.97 + Math.sin(pt.life * 0.15) * 0.25; pt.vy = Math.min(pt.vy, 1.6); }
    }
    for (const e of fxs) e.t++;
    fxs = fxs.filter((e) => e.t < e.life);
    if (m.mono > 0) m.mono--;
    for (const c of cracks) c.life--;
    cracks = cracks.filter((c) => c.life > 0);
    particles = particles.filter((pt) => pt.life > 0);
    for (const t of texts) { t.y -= 0.8; t.life--; }
    texts = texts.filter((t) => t.life > 0);
    shake *= 0.85;
    if (m.koFlash > 0) m.koFlash--;
    // 力をためる間：ほかは止まり、光の粒が集まってくる
    if (m.charge) {
      const ch = m.charge, f = ch.c.f;
      if (ch.t === 0 && ch.c.result === 'guard') popText(ch.c.o.x, ch.c.o.y - 185, L('読んだ!', 'SAW IT COMING!'), '#2a6fb0', 28);
      if (ch.c.result === 'guard') ch.c.o.guarding = true;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU, d = rand(140, 200), x = f.x + Math.cos(a) * d, y = f.y - 90 + Math.sin(a) * d;
        particles.push({ x, y, vx: (f.x - x) / 16, vy: (f.y - 90 - y) / 16, g: 0, life: 16, color: f.side === 0 ? '#ffb04a' : '#7ac0ff', r: 4 });
      }
      if (++ch.t >= CHARGE_LEN) {
        m.charge = null;
        m.superName = { name: ch.c.sup.name, side: f.side };
        m.superSlow = SLOW_LEN;
        execSuper(ch.c);
      }
      updateCamera(m);
      return;
    }

    if (m.phase === 'intro') {
      m.phaseT++;
      if (m.phaseT === 1) sfx('vs');
      if (m.phaseT === 90) sfx('fight');
      if (m.phaseT > 130) { m.phase = 'fight'; m.lastDmg = m.frame; m.fightStart = m.frame; }
      m.p.update(NO_INPUT, m.c); m.c.update(NO_INPUT, m.p);
      auraTick(m.p); auraTick(m.c);
      updateCamera(m);
      return;
    }
    if (m.phase === 'ko') {
      for (const f of [m.p, m.c]) if (f.dust) {
        f.dust++;
        const cut = f.y - 220 + Math.max(0, Math.min(1, (f.dust - 30) / 70)) * 240;   // 倒れた余韻のあとに崩れ始める
        if (f.dust > 30 && f.dust < 105) for (let i = 0; i < 4; i++) {
          particles.push({ x: f.x + rand(-45, 45), y: cut + rand(0, 8), vx: rand(-0.8, 0.8) + 0.6, vy: rand(-1, 0.5), life: 40 + Math.random() * 30,
            color: Math.random() < 0.5 ? '#c9a36b' : '#e6cf9a', r: 2 + Math.random() * 2.5, g: 0.18 });
        }
      }
      m.phaseT++;
      // 最初は止める → ゆっくり → ふつう
      const every = !m.koFocus ? 3 : m.phaseT < 24 ? 0 : m.phaseT < 110 ? 4 : 2;
      if (every && m.phaseT % every === 0) { m.p.update(NO_INPUT, m.c); m.c.update(NO_INPUT, m.p); }
      updateCamera(m);
      if (m.phaseT > (m.koFocus ? 200 : 160)) finishMatch();
      return;
    }
    if (hitstop > 0) { hitstop--; return; }
    m.p.update(m.ai[0].think(m.p, m.c), m.c);
    m.c.update(m.ai[1].think(m.c, m.p), m.p);
    updateProjectiles(m);
    updateField(m);
    auraTick(m.p); auraTick(m.c);
    updateCamera(m);
    // 押し合い
    const dx = m.c.x - m.p.x;
    if (Math.abs(dx) < 50 && Math.abs(m.c.y - m.p.y) < 100) {
      const push = (50 - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
      m.p.x = Math.max(40, m.p.x - push); m.c.x = Math.min(W - 40, m.c.x + push);
    }
    m.timer--;
    if (m.p.hp <= 0 || m.c.hp <= 0 || m.timer <= 0 || m.void) endRound();
  }

  let runMatch = null;   // 勝ち抜きで最後に勝った試合（「ここでやめる」の結果に使う）
  function finishMatch() {
    const m = match, w = m.winner, versus = m.kind === 'versus';
    // 図鑑の記録と、新しく見つけた特別な漢字（その字で勝ったときだけ図鑑に登録。2人対戦は勝った側の字）
    recordPlay(m.p.weapon.ch, w === 0);
    if (versus) recordPlay(m.c.weapon.ch, w === 1);
    const news = w === 0 ? recordFound(m.p.weapon.ch) : versus && w === 1 ? recordFound(m.c.weapon.ch) : null;
    match = null;
    // 勝ち抜きで勝ったら、HPを少し回復して次の相手へ
    if (m.kind === 'survival' && w === 0 && run) {
      run.wins++; run.hp = 100;   // 前の試合のダメージは持ち越さない。毎試合HP満タンで戦う
      runMatch = m;
      showNext(news);
      return;
    }
    endWith(m, news, false);
  }
  const newsText = (news) => (news.unlockedNow
    ? L(`新発見！『${news.ch}』 ${news.count}／${TOTAL}　封印が解けた！『龘』が使えるようになった`, `New find! ${news.ch} ${news.count}/${TOTAL}  The seal is broken! You can now use 龘`)
    : L(`新発見！『${news.ch}』 ${news.count}／${TOTAL}`, `New find! ${news.ch} ${news.count}/${TOTAL}`));
  // 勝ち負けの音が鳴り終わってから、ゆったりした曲に戻す
  const menuMusicSoon = () => setTimeout(() => { if (!match && window.Bgm) Bgm.play('menu'); }, 2600);
  // 結果画面へ（勝ち抜きは、負けたとき・やめたときにここへ来る）
  function endWith(m, news, quit) {
    let godNews = null;
    if (m.kind === 'survival') {
      m.runWins = run ? run.wins : 0; m.runQuit = quit;
      m.newBest = saveBest(m.runWins, m.p.weapon.ch);
      run = null;
      // 10連勝以上で終わったら、最終結果で「漢字ファイターの神」の称号と一緒に『神』の封印が解ける（図鑑にも入る）
      if (m.runWins >= 10 && openGod()) godNews = recordFound('神') || { ch: '神', count: found.size };
    }
    lastResult = resultOf(m);
    showResult(lastResult);
    showResultFx(lastResult.display);
    sfx(lastResult.display === 0 ? 'win' : 'lose');
    const lines = [];
    if (news) lines.push(newsText(news));
    if (godNews) lines.push(L('神の封印が解けた！『神』が本当の力で使えるようになった', 'The seal on 神 is broken! You can now use its true power'));
    if (godNews && godNews.unlockedNow) lines.push(L('『龘』の封印も解けた！', 'The seal on 龘 is broken too!'));
    if (m.newBest) lines.push(L('自己ベスト更新！', 'New personal best!'));
    const box = $('result-news');
    box.classList.toggle('hidden', !lines.length);
    box.classList.toggle('unlock', !!((news && news.unlockedNow) || godNews));
    box.textContent = lines.join('　');
    menuMusicSoon();
    showScreen('screen-result');
    // 図鑑に登録される演出（ふつうの字 → 神 → 龘 の順）
    const q = [];
    if (news) q.push({ ch: news.ch, count: news.count });
    if (news && news.unlockedNow) q.push({ ch: '龘', divine: true });
    if (godNews) q.push({ ch: '神', count: godNews.count, divine: true, wins: m.runWins });
    if (godNews && godNews.unlockedNow) q.push({ ch: '龘', divine: true });
    if (q.length) setTimeout(() => DexReveal.play(q), 900);
  }
  // 勝ち抜き：次の相手の前の画面
  const STAGE_MSG = EN ? { 10: '10 wins! Sunset falls on the dojo', 20: '20 wins! Night comes to the dojo', 30: '30 wins! The red moon rises' }
    : { 10: '10連勝！ 道場が夕暮れになった', 20: '20連勝！ 道場に夜が来た', 30: '30連勝！ 赤い月が昇った' };
  function showNext(news) {
    const k = run.wins;
    const c = $('next-title'), g = c.getContext('2d'), img = Texture.render(L(`${k}連勝!!`, `${k} WINS!!`), 120, 'red');
    c.width = Math.ceil(img.w * 2); c.height = Math.ceil(img.h * 2);
    g.setTransform(2, 0, 0, 2, 0, 0); g.drawImage(img.canvas, 0, 0, img.w, img.h);
    c.setAttribute('aria-label', L(`${k}連勝`, `${k} wins`));
    $('next-info').textContent = L('HPは満タンに戻った。', 'HP fully restored. ') + (isBoss(k)
      ? L(`次は${k + 1}人目、特別な字が待ちかまえている！`, `Opponent #${k + 1} is a special kanji boss!`) : L('次の相手は、もっと画数が多い', 'The next opponent has even more strokes'));
    const stage = STAGE_MSG[k] || (k > 30 && k % 10 === 0 ? L(`${k}連勝！ まだ勝ち続ける…`, `${k} wins! Still going…`) : '');
    // 10連勝しても、神の封印は勝ち抜きが終わったときの最終結果で解ける（ここでは予告だけ）
    const godSoon = k === 10 && !godOpen ? L('神の気配がする…（勝ち抜きを終えると、最終結果で何かが起きる）', 'You sense something divine… (finish the run to see)') : '';
    const lines = [stage, godSoon, news ? newsText(news) : ''].filter(Boolean);
    $('next-news').classList.toggle('hidden', !lines.length);
    $('next-news').textContent = lines.join('　');
    sfx(news && news.unlockedNow ? 'unlock' : 'win');
    $('next-news').classList.toggle('unlock', !!godSoon);
    menuMusicSoon();
    showScreen('screen-next');
    const q = [];
    if (news) q.push({ ch: news.ch, count: news.count });
    if (news && news.unlockedNow) q.push({ ch: '龘', divine: true });
    if (q.length) setTimeout(() => DexReveal.play(q), 700);
  }

  // ---------- 結果カード（SNSでシェアする画像）----------
  const CARD_W = 1200, CARD_H = 675;   // Xのタイムラインで切れない 16:9
  const SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
  let lastResult = null;
  let lastCardCanvas = null;
  // 字の称号：特別な字は効果名、ふつうの字は画数の階級
  function titleOf(w) {
    if (Weapon.isSpecial(w.ch)) return L(`特別な字・${EFFECT_NAME[w.effect] || 'なぞ'}の使い手`, `Special Kanji · Master of ${effectName(w.effect) || 'mystery'}`);
    const s = w.strokes;
    const i = s <= 3 ? 0 : s <= 7 ? 1 : s <= 12 ? 2 : s <= 19 ? 3 : s <= 29 ? 4 : 5;
    if (EN) return `${s}-Stroke ${['Peashooter', 'Lightweight', 'Middleweight', 'Heavyweight', 'Super Heavyweight', 'Skyscraper'][i]} Class`;
    return `${s}画の${['豆鉄砲級', '軽量級', '中量級', '重量級', '超重量級', '建造物級'][i]}`;
  }
  // 勝ち抜きの称号（連勝数で決まる）
  const STREAK_TITLES = EN ? [
    [10, 'Kanji Fighter God'], [9, 'Legendary Kanji Fighter'], [6, 'Pro Kanji Fighter'],
    [3, 'Decent Kanji Fighter'], [0, 'Rookie Kanji Fighter'],
  ] : [
    [10, '漢字ファイターの神'], [9, '伝説の漢字ファイター'], [6, 'プロの漢字ファイター'],
    [3, '一人前の漢字ファイター'], [0, '見習い漢字ファイター'],
  ];
  const streakTitle = (k) => STREAK_TITLES.find((a) => k >= a[0])[1];
  // 試合の結果を、カードと投稿文に使う形にまとめる
  function resultOf(m) {
    const P = m.p.weapon, C = m.c.weapon, w = m.winner;
    let v = verdict(m), headline, stamp = null;
    // display：見た目の勝ち負け（0 祝う / 1 しょんぼり / -1 引き分け）
    let display = m.kind === 'versus' && w >= 0 ? 0 : w;
    let titleText = m.kind === 'versus'
      ? (w < 0 ? L('引き分け', 'DRAW') : L(`${w === 0 ? '1P' : '2P'}の勝ち!!`, `${w === 0 ? '1P' : '2P'} WINS!!`))
      : w === 0 ? L('勝利!!', 'VICTORY!!') : w === 1 ? L('敗北…', 'DEFEAT…') : L('引き分け', 'DRAW');
    if (m.kind === 'survival') {
      const k = m.runWins || 0;
      // 大事なのは「どの字で」「何連勝」「称号」の3つだけ
      headline = L(`『${P.ch}』で${k}連勝${k > 0 ? '！' : '…'}`, `${k} win${k === 1 ? '' : 's'} with ${P.ch}${k > 0 ? '!' : '…'}`);
      v = null;
      display = k > 0 ? 0 : 1;
      stamp = L(`${k}連勝`, `${k} WINS`); titleText = k > 0 ? L(`${k}連勝!!`, `${k} WINS!!`) : L('0連勝…', '0 WINS…');
    } else if (m.kind === 'versus') {
      headline = L(`1P『${P.ch}』 vs 2P『${C.ch}』　` + (w < 0 ? '引き分け' : `${w === 0 ? '1P' : '2P'}の勝ち！`), `1P ${P.ch} vs 2P ${C.ch}  ` + (w < 0 ? 'Draw' : `${w === 0 ? '1P' : '2P'} wins!`));
    } else {
      headline = w === 0 ? L(`『${P.ch}』で『${C.ch}』を倒した！`, `${P.ch} defeated ${C.ch}!`)
        : w === 1 ? L(`『${P.ch}』は『${C.ch}』に敗れた…`, `${P.ch} lost to ${C.ch}…`) : L(`『${P.ch}』と『${C.ch}』は引き分け`, `${P.ch} and ${C.ch} tied`);
    }
    const champ = m.kind === 'versus' && w === 1 ? C : P;     // 2人対戦は、勝った字の称号
    const title = m.kind === 'survival' ? streakTitle(m.runWins || 0) : titleOf(champ);
    return {
      winner: w, kind: m.kind, names: m.names, p: P, c: C, headline, title, verdict: v,
      display, stamp, titleText,
    };
  }
  // 横幅に収まるよう文字を縮めて書く
  function fitText(g, str, x, y, maxW, size, family, align) {
    g.font = `bold ${size}px ${family}`;
    const w = g.measureText(str).width;
    if (w > maxW) { size = Math.floor(size * maxW / w); g.font = `bold ${size}px ${family}`; }
    g.textAlign = align || 'left'; g.textBaseline = 'middle';
    g.fillText(str, x, y);
  }
  function drawCard(r) {
    const c = document.createElement('canvas');
    c.width = CARD_W; c.height = CARD_H;
    const g = c.getContext('2d');
    const versus = r.kind === 'versus', p2win = versus && r.winner === 1;
    const win = r.display === 0, lose = r.display === 1;
    g.fillStyle = win ? '#fff4d6' : lose ? '#e9edf3' : '#f4efe4'; g.fillRect(0, 0, CARD_W, CARD_H);

    // 自分の字のうしろに集中線
    const cx = 330, cy = 285;
    g.save(); g.translate(cx, cy);
    const N = 64;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, d = Math.PI / N * (i % 2 ? 0.55 : 0.9);
      g.fillStyle = win ? (i % 2 ? 'rgba(255,200,40,0.6)' : 'rgba(232,80,60,0.22)')
                        : lose ? 'rgba(90,110,150,0.16)' : 'rgba(150,130,90,0.18)';
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a - d) * 1500, Math.sin(a - d) * 1500);
      g.lineTo(Math.cos(a + d) * 1500, Math.sin(a + d) * 1500);
      g.fill();
    }
    g.restore();

    // ロゴ（左上）
    drawBrand(g, 18, 0, 0.3);

    // 主役の字（左に大きく）。ふつうは自分の字、2人対戦で2Pが勝ったときは2Pの字を主役にする
    const [n1, n2] = r.names || [L('あなた', 'YOU'), 'CPU'];
    const main = p2win ? r.c : r.p, sub = p2win ? r.p : r.c, [nMain, nSub] = p2win ? [n2, n1] : [n1, n2];
    const subLost = versus ? r.winner >= 0 : r.winner === 0;   // 負けた相手は薄く傾ける
    Texture.draw(g, main.ch, cx, cy, Texture.fitSize(main.ch, 330, 440), weaponStyle(main), lose ? -0.08 : 0);
    Texture.draw(g, r.stamp || (win ? L('勝利', 'WIN') : lose ? L('敗北', 'LOSE') : L('引分', 'DRAW')), cx + 170, cy + 140, EN ? 64 : 84, win ? 'red' : 'silver', -0.18);

    // VS と相手の字
    Texture.draw(g, 'VS', 690, 280, 76, 'red');
    g.save();
    if (subLost) g.globalAlpha = 0.6;
    Texture.draw(g, sub.ch, 935, 270, Texture.fitSize(sub.ch, 210, 300), weaponStyle(sub), subLost ? 0.35 : 0);
    g.restore();

    // 名札
    g.fillStyle = '#4a3416';
    fitText(g, nMain, cx, 470, 300, 26, SANS, 'center');
    fitText(g, nSub, 935, 470, 300, 26, SANS, 'center');

    // 下の帯：見出し・称号・勝因・戦績
    g.fillStyle = 'rgba(255,255,255,0.93)'; g.fillRect(0, 500, CARD_W, CARD_H - 500);
    g.fillStyle = '#222'; g.fillRect(0, 500, CARD_W, 5);
    g.fillStyle = '#222';
    fitText(g, r.headline, 44, 555, 1110, 56, Texture.FONT);
    g.fillStyle = '#8a1c14';
    fitText(g, L(`称号：${r.title}`, `Title: ${r.title}`), 46, 610, 1100, 28, SANS);
    g.fillStyle = '#444';
    if (r.verdict) fitText(g, `${r.verdict.head}：${r.verdict.body}`, 46, 648, 780, 24, SANS);
    g.fillStyle = '#d33';
    fitText(g, L('#漢字ファイター', '#KanjiFighter'), 1160, 648, 300, 30, Texture.FONT, 'right');
    return c;
  }
  // 𝕏 に投稿する文の最後に付ける、ゲームのURL（GitHub Pages で公開しているもの）
  const GAME_URL = 'https://yurugamelab.github.io/kanji-fighter/';
  function shareText(r) {
    return `${r.headline}\n` + L(`称号：${r.title}\n`, `Title: ${r.title}\n`) + (r.verdict ? `${r.verdict.head}${L('：', ': ')}${r.verdict.body}\n` : '') + L('#漢字ファイター', '#KanjiFighter') + '\n' + GAME_URL;
  }
  function showResult(r) {
    const img = $('result-card');
    try { lastCardCanvas = drawCard(r); img.src = lastCardCanvas.toDataURL('image/png'); } catch (e) { img.removeAttribute('src'); }
    img.alt = `${r.headline} ` + L(`称号：${r.title}`, `Title: ${r.title}`) + (r.verdict ? ` ${r.verdict.head}${L('：', ': ')}${r.verdict.body}` : '');
    $('result-rank').classList.toggle('hidden', r.kind !== 'survival');
    $('result-rank-name').textContent = r.title;
    $('btn-share').href = 'https://x.com/intent/post?text=' + encodeURIComponent(shareText(r));
    $('btn-change').textContent = r.kind === 'versus' ? L('字を選び直す', 'Pick again') : L('漢字を変える', 'Change kanji');
    drawResultTitle(r);
  }
  // 結果画面の大見出し（勝利!! は赤、敗北… は銀。2人対戦は「1Pの勝ち!!」、勝ち抜きは「7連勝!!」）
  function drawResultTitle(r) {
    const c = $('result-title'), g = c.getContext('2d');
    const text = r.titleText;
    const img = Texture.render(text, 120, r.display === 0 ? 'red' : 'silver');
    c.width = Math.ceil(img.w * 2); c.height = Math.ceil(img.h * 2);
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, img.w, img.h);
    g.drawImage(img.canvas, 0, 0, img.w, img.h);
    c.setAttribute('aria-label', text);
  }
  // 勝ち：回る集中線と紙吹雪 / 負け：雨 / 引き分け：なし
  function showResultFx(winner) {
    const scr = $('screen-result'), fx = $('result-fx');
    scr.classList.remove('win', 'lose', 'draw');
    void scr.offsetWidth;                                  // 見出しのアニメーションを最初から
    scr.classList.add(winner === 0 ? 'win' : winner === 1 ? 'lose' : 'draw');
    fx.innerHTML = '';
    const add = (cls) => { const d = document.createElement('div'); d.className = cls; fx.appendChild(d); return d; };
    if (winner === 0) {
      add('sunburst');
      const colors = ['#e8604c', '#4c7be8', '#ffffff', '#4cd964', '#ff5b9a', '#8a1c14'];
      for (let i = 0; i < 40; i++) {
        const s = document.createElement('span');
        s.className = 'confetti';
        s.style.left = Math.random() * 100 + '%';
        s.style.background = colors[i % colors.length];
        s.style.animationDuration = (2.5 + Math.random() * 2.5) + 's';
        s.style.animationDelay = (-Math.random() * 4) + 's';
        fx.appendChild(s);
      }
    } else if (winner === 1) add('rain');
  }

  // ---------- 描画 ----------
  // 背景の絵（3D素材の道場を、部屋の手前から奥の壁に向けて撮ったもの）。PCは横長（目の高さで水平）、スマホ縦は縦長（少し高い位置から少し下向き＝床が多い）
  //   hf：絵の中の地平線の高さ（上から何割）。rise：地平線をキャラの足元から何px上に置くか（カメラの高さに比例。目の高さ150なら胸のあたり）
  const BG = { wide: { img: IMG.bg, hf: 0.5, rise: 120 }, tall: { img: IMG.bgTall, hf: 0.422, rise: 240 } };
  // 画面を覆う大きさで、地平線を決めた高さに置く
  function bgFit() {
    const b = portrait && ready(BG.tall.img) ? BG.tall : BG.wide;
    if (!ready(b.img)) return null;
    const iw = b.img.naturalWidth, ih = b.img.naturalHeight, hz = GROUND - b.rise;
    const s = Math.max(W / iw, hz / (ih * b.hf), (H - hz) / (ih * (1 - b.hf)));
    return { img: b.img, x: (W - iw * s) / 2, y: hz - ih * b.hf * s, w: iw * s, h: ih * s };
  }
  // 勝ち抜きで10連勝ごとに道場の時間が進む：夕暮れ → 夜 → 赤い月
  function stageTint(x, y, w, h) {
    const k = match && match.stage ? Math.floor(match.stage / 10) : 0;
    if (!k) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ['', '#ffb27a', '#5a6aa8', '#a83a3a'][Math.min(3, k)];
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
    if (k >= 2) {                                         // 夜は月を出す
      ctx.fillStyle = k >= 3 ? 'rgba(255,90,70,0.85)' : 'rgba(255,250,220,0.85)';
      ctx.beginPath(); ctx.arc(W * 0.68, GROUND * 0.3, 30, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawBg() {
    const b = bgFit();
    if (b) {
      ctx.drawImage(b.img, b.x, b.y, b.w, b.h);
      stageTint(b.x, b.y, b.w, b.h);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#bfe6ff'); g.addColorStop(1, '#fdf6e3');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.font = `bold ${Math.round(Math.min(W, GROUND) * 0.7)}px ${Weapon.FONT_FAMILY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('闘', W / 2, GROUND / 2 + 20);
    ctx.fillStyle = '#c9a36b'; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#b08850'; ctx.fillRect(0, GROUND, W, 6);
  }

  // 武器の字：特別な字は赤＋金、ふつうの字は銀
  const weaponStyle = (w) => (Weapon.isSpecial(w.ch) ? 'red' : 'silver');
  function drawWeaponGlyph(w, x, y, size, rot) {
    Texture.draw(ctx, w.ch, x, y, w.baseSize, weaponStyle(w), rot, size / w.baseSize);
  }

  // ---------- キャラの状態の見せ方（色・顔のまわりの記号）----------
  function spriteColor(f) {                     // いま体に混ぜる色と濃さ
    if (f.hitFlash > 0) return ['#ffffff', 0.7];
    if (f.mu > 0) return ['#f4f4f4', 0.55 + Math.sin(f.t * 0.2) * 0.1];   // 無の境地：白く透き通る
    if (f.frozen > 0) return ['#8cc8ff', 0.55];
    if (f.timestop > 0) return ['#5a5a6e', 0.5];
    if (f.stunned > 0 && f.stunned % 6 < 3) return ['#ffe600', 0.45];
    if (f.spicy > 0) return ['#ff3b1f', 0.3];
    if (f.poison > 0 && !f.bugs) return ['#9b4dca', 0.25];
    if (f.curse > 0) return ['#5b2a86', 0.25];
    if (f.slip > 0) return ['#5aa0e6', 0.2];
    if (f.gloom > 0) return ['#4a5a7a', 0.08 + f.gloom * 0.07];             // 鬱：青ざめて元気がない
    if (f.sticky > 0) return ['#f0e6c8', 0.45];
    if (f.charm > 0) return ['#ff7eb6', 0.18];
    return null;
  }
  // ---------- キャラ（カプセル型の棒人間・3頭身・のっぺらぼう、1Pは赤・2Pは青の柔道着）----------
  // 関節の位置から手足を丸い筒で描く。漢字を目立たせるため、輪郭線は付けない
  const BODY_K = 1.35;                       // 体の大きさの倍率
  const HEAD_R = 25;
  const TEAM_COL = [
    { gi: '#d9392b', lt: '#f07a6c', dk: '#a8261b' },
    { gi: '#2f62c9', lt: '#7ea2ea', dk: '#1f4799' },
  ];
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  // 状態（凍結・毒など）の色を混ぜた体の色
  function bodyColors(f) {
    const base = TEAM_COL[f.side], tc = spriteColor(f), m = (c) => (tc ? mixHex(c, tc[0], tc[1]) : c);
    return { gi: m(base.gi), lt: m(base.lt), dk: m(base.dk), head: m('#d6cab6'), headL: m('#ffffff'),
             skin: m('#d9c9b0'), skinL: m('#f6eee0'), belt: m('#2a2a2a') };
  }
  const isCrouching = (f) => f.crouch || (f.atk && f.atk.name === 'sweep');
  // 関節の位置（右向き・足元が原点）。歩く・跳ぶ・しゃがむで足の形が変わる
  function bodyPose(f) {
    const b = Math.sin(f.t * 0.12) * 1.5, crouch = isCrouching(f), air = !f.onGround && f.fx !== 'fly';
    const hipY = crouch ? -24 : -38, J = {};
    J.hip = [0, hipY + b]; J.chest = [2, hipY - 26 + b]; J.neck = [3, hipY - 34 + b]; J.head = [4, hipY - 34 - HEAD_R + b];
    J.sf = [9, hipY - 28 + b]; J.sb = [-5, hipY - 28 + b];
    J.eb = [6, hipY - 16 + b]; J.hb = [14, hipY - 26 + b];
    const walk = f.onGround && !crouch && Math.abs(f.vx) > 0.6 ? Math.sin(f.t * 0.35) : 0;
    if (air) { J.kf = [14, hipY + 14]; J.ff = [10, hipY + 32]; J.kb = [-2, hipY + 16]; J.fb = [-12, hipY + 32]; }
    else if (crouch) { J.kf = [18, -14]; J.ff = [20, 0]; J.kb = [-14, -12]; J.fb = [-18, 0]; }
    else if (f.fx === 'god') { J.kf = [4, -19]; J.ff = [5, 0]; J.kb = [-3, -19]; J.fb = [-4, 0]; }   // 神：足をそろえて直立したまま（歩かずに滑って動く）
    else if (f.kickT > 0) {                                        // 蹴：ひざを上げて構え → 前へ高く蹴り上げる → 戻す
      const p = 1 - f.kickT / KICK_LEN, up = p < 0.3 ? p / 0.3 : 0, out = p < 0.3 ? 0 : p < 0.55 ? (p - 0.3) / 0.25 : Math.max(0, 1 - (p - 0.55) / 0.45);
      // 蹴るのは手前の脚（後ろ足）。奥の脚で蹴ると体に隠れて見えないので
      J.kf = [11, -19]; J.ff = [18, 0]; J.kick = 1;
      J.kb = [-6 + up * 16 + out * 14, -18 - up * 26 - out * 34];
      J.fb = [-14 + up * 18 + out * 74, -up * 26 - out * 58];          // 振り抜いたときは、脚をまっすぐ前へのばす（腰より少し上）
      J.fbX = -9 + out * 30;                                           // 3D：足先を体の前へ回して、画面で横へ伸びて見えるように
      J.chest[0] -= out * 10; J.neck[0] -= out * 12; J.head[0] -= out * 12;   // 蹴るときは上体を後ろへ反らす
    }
    else {
      J.kf = [11 + walk * 4, -19 - Math.max(0, walk) * 6]; J.ff = [17 + walk * 9, -Math.max(0, walk) * 5];
      J.kb = [-9 - walk * 4, -18 - Math.max(0, -walk) * 6]; J.fb = [-16 - walk * 9, -Math.max(0, -walk) * 5];
    }
    return J;
  }
  function capsule(a, b, w, C) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.gi; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.strokeStyle = C.lt; ctx.lineWidth = w * 0.3;                          // 光沢
    ctx.beginPath(); ctx.moveTo(a[0] - w * 0.2, a[1] - w * 0.2); ctx.lineTo(b[0] - w * 0.2, b[1] - w * 0.2); ctx.stroke();
  }
  function sphere(p, r, base, light) {
    const g = ctx.createRadialGradient(p[0] - r * 0.4, p[1] - r * 0.45, r * 0.15, p[0], p[1], r);
    g.addColorStop(0, light); g.addColorStop(1, base);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
  }
  const use3D = () => window.Char3D && window.Char3D.ready;
  function leanOf(f) {                       // 攻撃・被弾で体を傾ける角度
    let lean = 0;
    if (f.atk) { const a = f.atk, act = a.t >= a.su && a.t < a.su + a.act; lean = act ? 0.14 : a.t < a.su ? -0.06 : 0.04; }
    if (f.hitstun > 0) lean = -0.16;
    else if (f.fx === 'god' && !f.atk && f.onGround && Math.abs(f.vx) > 0.6) lean = 0.08 * Math.sign(f.vx) * f.facing;   // 神：進む向きに少し傾いて滑る
    return lean;
  }
  function bodyTransform(f) {                // 体を描く向き（足元が原点、前向きが +x）
    if (f.twister) { const c = Math.cos(f.t * 0.45); ctx.translate(f.x, 0); ctx.scale(Math.sign(c || 1) * Math.max(0.15, Math.abs(c)), 1); ctx.translate(-f.x, 0); }   // 竜巻でくるくる回る
    ctx.translate(f.x, f.y); ctx.rotate(leanOf(f) * f.facing);
  }
  // 3Dのキャラの表情と、手前の手の形（3D素材の顔5種・手7種を使い分ける）
  function face3D(f) {
    const m = match, over = m && m.phase === 'ko';
    if (f.down > 0 || f.hp <= 0 || (over && m.koLoser === f) || f.stunned > 0 || f.dizzy > 0 || f.confused > 0 || f.swoon > 0) return 'KO';
    if (f.hitstun > 0 || f.hitFlash > 0 || f.frozen > 0 || f.bound > 0) return 'surprise';
    if ((over && m.winner === f.side) || f.laugh > 0 || f.t < (f.grinUntil || 0)) return 'grin';
    if (f.atk || (m && m.cutin && m.cutin.f === f) || (m && m.charge && m.charge.c.f === f)) return 'shout';
    return 'neutral';
  }
  function hand3D(f) {
    const m = match;
    if (f.down > 0 || f.hp <= 0) return 'neutral';
    if (f.stunned > 0 || f.dizzy > 0 || f.confused > 0 || f.sleep > 0) return 'ball';
    if (f.hitstun > 0) return 'wing';
    if ((m && m.cutin && m.cutin.f === f) || (m && m.charge && m.charge.c.f === f)) return 'tigerclaw';
    if (f.atk && f.atk.name === 'weak') return 'palmstrike';
    if (f.atk) return 'fist';
    if (!f.onGround) return 'tigerclaw';
    if (f.guarding) return 'palmstrike';
    return 'karatechop';
  }
  // 長方形（中心 x,y、ang の向きに半分の長さ a、直角の向きに半分の幅 b）が、体の枠に重なるか（分離軸で調べる）
  function glyphHitsBody(f, x, y, a, b, ang) {
    // 3Dのキャラは髪と鉢巻が体の枠より上に出るので、上は HEAD_TOP だけ広げる
    const HEAD_TOP = 14, r = f.hurtbox(), top = r.y - HEAD_TOP, bot = r.y + r.h + 6;
    const hw = r.w / 2 + 10, hh = (bot - top) / 2, dx = x - (r.x + r.w / 2), dy = y - (top + bot) / 2;
    const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
    if (Math.abs(dx) > hw + a * c + b * s || Math.abs(dy) > hh + a * s + b * c) return false;
    const du = dx * Math.cos(ang) + dy * Math.sin(ang), dv = -dx * Math.sin(ang) + dy * Math.cos(ang);
    return Math.abs(du) <= a + hw * c + hh * s && Math.abs(dv) <= b + hw * s + hh * c;
  }
  // 描いた字の半分の幅（字の大きさに対して）。縁取り（約0.1）と下の厚み（約0.07）を含める（texture.js の render）
  const GLYPH_HALF = 0.66;
  // 描く字の形（縁取りこみ）。drawFighter の描き方（伸びる字・麺・溜め）に合わせる
  function glyphShape(f, g) {
    let sz = f.weapon.size * (f.giant || 1);
    const dx = g.cx - g.hx, dy = g.cy - g.hy, len = Math.hypot(dx, dy) || 1, st = f.stretchAmt();
    if (st > 0.05 && f.fx !== 'slurp') {                          // 伸：手元から先まで伸びる
      const ex = g.cx + dx / len * sz * 0.5, ey = g.cy + dy / len * sz * 0.5;
      const sx = Math.max(1, 1 + ((len + sz * 0.5) / sz - 1) * st), h = sz * GLYPH_HALF;
      return { x: g.cx + ((g.hx + ex) / 2 - g.cx) * st, y: g.cy + ((g.hy + ey) / 2 - g.cy) * st, a: h * sx, b: h * (1 - 0.15 * st), ang: Math.atan2(dy, dx) };
    }
    if (st > 0.05) sz *= 1 + 0.25 * st;
    if (f.atk && f.atk.charge > 0) sz *= 1.02 + f.atk.charge / 200;
    return { x: g.cx, y: g.cy, a: sz * GLYPH_HALF, b: sz * GLYPH_HALF, ang: g.rot };
  }
  // 拳のほうへ寄せた字が体に重なるときは、字の向き（手→字）に沿って、重ならないところまで離す
  function clearOfBody(f, g, sh) {
    const dx = g.cx - g.hx, dy = g.cy - g.hy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, q = glyphShape(f, g);
    for (let t = 0; t < 800; t += 3) {
      const x = sh.x + ux * t, y = sh.y + uy * t;
      if (!glyphHitsBody(f, q.x + x, q.y + y, q.a, q.b, q.ang)) return { x, y };
    }
    return sh;
  }
  // 3Dの腕を伸ばす先：字の手前の端（届かない分は f.gripShift で字を拳のほうへ寄せて描く）
  function gripEdge(f, g) {
    const dx = g.cx - g.hx, dy = g.cy - g.hy, len = Math.hypot(dx, dy) || 1, ws = f.weapon.size * (f.giant || 1);
    const k = Math.max(0, len - ws * 0.4) / len;
    return { x: g.hx + dx * k, y: g.hy + dy * k };
  }
  function drawCapsuleBody(f) {
    const C = bodyColors(f), J = bodyPose(f), d = f.facing, lean = leanOf(f);
    ctx.save();
    // 3Dのキャラ（char3d.js）：漢字を握る拳を、字の手前の端（体の傾きを戻した位置）に合わせる
    if (use3D()) {
      bodyTransform(f); ctx.scale(d, 1);
      const g = f.weaponGeom(), e = gripEdge(f, g), ux = e.x - f.x, uy = e.y - f.y, c = Math.cos(-lean * d), s = Math.sin(-lean * d);
      const grip = [(ux * c - uy * s) * d, -(ux * s + uy * c)];
      let fist = null;
      try { fist = window.Char3D.draw(ctx, f.side, { J, grip, spin: f.buttT > 0 ? Math.PI : 0, tint: spriteColor(f), face: face3D(f), hand: hand3D(f), bend: f.bow > 0 ? 0.6 * Math.sin(Math.PI * Math.min(1, (30 - f.bow) / 12) / 2) : f.gloom > 0 && !f.atk && f.down <= 0 ? GLOOM_BEND * f.gloom + (f.sighT > 0 ? SIGH_BEND * Math.sin(Math.PI * (SIGH_LEN - f.sighT) / SIGH_LEN) : 0) : 0, look: f.hitstun > 0 || f.hitFlash > 0 || f.down > 0 || f.hp <= 0 }); }
      catch (e) { window.Char3D.ready = false; console.warn('3Dキャラを描けなかったので、棒人間に戻します', e); }   // 止まらないように
      ctx.restore();
      if (fist) {
        // 字は拳のすぐ先に、少し浮かせて描く（拳とは重ねない）。当たり判定は動かさない
        const r = lean * d, lx = d * fist[0], ly = -fist[1];
        const fx = f.x + lx * Math.cos(r) - ly * Math.sin(r), fy = f.y + lx * Math.sin(r) + ly * Math.cos(r);
        const dx = g.cx - g.hx, dy = g.cy - g.hy, len = Math.hypot(dx, dy) || 1, ws = f.weapon.size * (f.giant || 1);
        const gap = ws * 0.1 + 14;                                   // 字の端と拳のあいだを少し空ける
        f.gripShift = { x: fx - e.x + dx / len * gap, y: fy - e.y + dy / len * gap };
        drawFaceMarks(f, isCrouching(f) ? 142 : 166);
        return;
      }
      ctx.save();
    }
    f.gripShift = null;
    bodyTransform(f); ctx.scale(d * BODY_K, BODY_K);
    // 奥の足・奥の腕
    capsule(J.hip, J.kb, 13, C); capsule(J.kb, J.fb, 12, C); sphere(J.fb, 6.5, C.skin, C.skinL);
    capsule(J.sb, J.eb, 12, C); capsule(J.eb, J.hb, 11, C); sphere(J.hb, 7.5, C.skin, C.skinL);
    // 上着
    const [hx, hy] = J.hip;
    ctx.fillStyle = C.gi;
    ctx.beginPath(); ctx.moveTo(J.sb[0] - 9, J.sb[1] - 2); ctx.lineTo(J.sf[0] + 9, J.sf[1] - 2); ctx.lineTo(hx + 16, hy + 5); ctx.lineTo(hx - 16, hy + 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.dk; ctx.globalAlpha *= 0.3;
    ctx.beginPath(); ctx.moveTo(J.sb[0] - 9, J.sb[1] - 2); ctx.lineTo(J.sb[0] + 1, J.sb[1] - 2); ctx.lineTo(hx - 6, hy + 5); ctx.lineTo(hx - 16, hy + 5); ctx.closePath(); ctx.fill();
    ctx.globalAlpha /= 0.3;
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(J.neck[0] - 6, J.neck[1] + 3); ctx.lineTo(J.chest[0] + 3, J.chest[1] + 10); ctx.lineTo(J.neck[0] + 8, J.neck[1] + 3); ctx.stroke();
    ctx.strokeStyle = C.belt; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(hx - 15, hy); ctx.lineTo(hx + 15, hy); ctx.stroke();
    // 手前の足
    capsule(J.hip, J.kf, 13, C); capsule(J.kf, J.ff, 12, C); sphere(J.ff, 6.5, C.skin, C.skinL);
    // 頭（のっぺらぼう）と鉢巻
    sphere(J.head, HEAD_R, C.head, C.headL);
    const [x, y] = J.head, wv = Math.sin(f.t * 0.15) * 4;
    ctx.strokeStyle = C.gi; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.ellipse(x, y - 8, HEAD_R - 0.5, 7, 0, 0.15, Math.PI - 0.15, true); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - HEAD_R + 2, y - 8); ctx.quadraticCurveTo(x - HEAD_R - 12, y - 4 + wv, x - HEAD_R - 24, y + 4 - wv);
    ctx.moveTo(x - HEAD_R + 2, y - 8); ctx.quadraticCurveTo(x - HEAD_R - 14, y - 16 - wv, x - HEAD_R - 26, y - 14 + wv);
    ctx.stroke();
    ctx.restore();
    drawFaceMarks(f, isCrouching(f) ? 142 : 166);
  }
  // 手前の腕：肩から、漢字を持つ手（武器の位置）まで伸びる
  function drawCapsuleArm(f, s, g) {
    if (use3D()) return;                                                    // 3Dのキャラは腕も体といっしょに描く
    const C = bodyColors(f), K = BODY_K;
    const mx = (s.x + g.hx) / 2, my = (s.y + g.hy) / 2 + 6 * K;              // ひじは少し下に曲げる
    ctx.save();
    ctx.lineCap = 'round';
    const seg = (ax, ay, bx, by, wd) => {
      ctx.strokeStyle = C.gi; ctx.lineWidth = wd;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = C.lt; ctx.lineWidth = wd * 0.3;
      ctx.beginPath(); ctx.moveTo(ax - wd * 0.2, ay - wd * 0.2); ctx.lineTo(bx - wd * 0.2, by - wd * 0.2); ctx.stroke();
    };
    seg(s.x, s.y, mx, my, 12 * K); seg(mx, my, g.hx, g.hy, 11 * K);
    const r = 8 * K, gr = ctx.createRadialGradient(g.hx - r * 0.4, g.hy - r * 0.45, r * 0.15, g.hx, g.hy, r);
    gr.addColorStop(0, C.skinL); gr.addColorStop(1, C.skin);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(g.hx, g.hy, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 顔のまわりの記号（汗・星・怒りマーク・ほっぺなど）
  function drawFaceMarks(f, h) {
    const hx = f.x, hy = f.y - h * 0.79, r = h * 0.17;                      // 頭の中心と半径のめやす
    ctx.save();
    if (f.hitstun > 0 || f.hp < 30) {                                       // 汗
      ctx.fillStyle = '#7fc4ff'; ctx.strokeStyle = '#2a6fb0'; ctx.lineWidth = 1.5;
      for (const [dx, dy, s] of [[1.05, -0.4, 1], [1.25, 0.05, 0.7]]) {
        const x = hx - f.facing * r * dx, y = hy + r * dy;
        ctx.beginPath(); ctx.moveTo(x, y - 7 * s); ctx.quadraticCurveTo(x + 5 * s, y, x, y + 4 * s); ctx.quadraticCurveTo(x - 5 * s, y, x, y - 7 * s); ctx.fill(); ctx.stroke();
      }
    }
    if (f.stunned > 0 || f.confused > 0 || f.dizzy > 0 || f.down > 0) {     // 頭の上を星が回る
      ctx.fillStyle = '#ffd000'; ctx.strokeStyle = '#8a6a00'; ctx.lineWidth = 1;
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) {
        const a = f.t * 0.15 + i * TAU / 3;
        ctx.fillText('★', hx + Math.cos(a) * r * 1.2, hy - r * 1.15 + Math.sin(a) * r * 0.35);
      }
    }
    if ((f.fx === 'rage' && f.hp < 60) || f.spicy > 0) {                    // 怒りマーク
      const x = hx + f.facing * r * 0.9, y = hy - r * 0.9, s = 9 + Math.sin(f.t * 0.5) * 1.5;
      ctx.strokeStyle = '#e02020'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath(); ctx.moveTo(x + px * 3, y + py * s); ctx.quadraticCurveTo(x + px * 3, y + py * 3, x + px * s, y + py * 3); ctx.stroke();
      }
    }
    if (f.fx === 'drunk' || f.charm > 0) {                                  // 赤いほっぺ
      ctx.fillStyle = f.charm > 0 ? 'rgba(255,90,160,0.55)' : 'rgba(255,60,60,0.5)';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx + s * r * 0.55, hy + r * 0.45, r * 0.22, r * 0.13, 0, 0, TAU); ctx.fill(); }
    }
    if (f.laugh > 0) {                                                      // 笑い：顔の横に w
      ctx.fillStyle = '#2a8a2a'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('www', hx + f.facing * r * 1.6, hy - r * 0.2 + Math.sin(f.t * 0.6) * 3);
    }
    if (f.sleep > 0 || (f.snoozing && f.nap > 0)) {                         // 眠り：鼻ちょうちん
      const s = 5 + (Math.sin(f.t * 0.08) + 1) * 4;
      ctx.fillStyle = 'rgba(200,230,255,0.7)'; ctx.strokeStyle = '#6aa0d0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx + f.facing * r * 0.5, hy + r * 0.3, s, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function faceOf(f) {
    if (f.down > 0) return '(@_@)';
    if (f.swoon > 0) return '(´；ω；`)';
    if (f.bound > 0) return '(＞＜)';
    if (f.snoozing && f.nap > 0) return '(-ω-)zZ';
    if (f.sleep > 0) return '(-_-)zZ';
    if (f.slip > 0) return '(;°д°)';
    if (f.gloom >= 3) return '(´・ω・`)';
    if (f.laugh > 0) return '(≧▽≦)';
    if (f.charm > 0) return '(♡ω♡)';
    if (f.spicy > 0) return '(>д<)';
    if (f.confused > 0) return '(@_@)';
    if (f.stunned > 0) return '(×_×)';
    if (f.nap > 0) return '(=^ω^=)';
    if (f.hitstun > 0) return '(>_<)';
    return f.face;
  }

  const GLOOM_BEND = 0.09;                                       // 鬱：やる気が下がるほど背中が丸まる（1段階あたりの前かがみの角度）
  // 神は宙に浮いて描く（当たり判定はそのまま）。ゆっくり上下に揺れる
  const godLift = (f) => (f.fx === 'god' && f.down <= 0 && f.hp > 0 && !f.dust ? 26 + Math.sin(f.t * 0.06) * 7 : 0);
  function drawFighter(f) {
    if (f.fx === 'lightspeed' && f.lightTrail && !f.dust && f.hp > 0) {      // 光：半透明の光の残像
      f.lightTrail.forEach((p, i) => drawGhostOf(f, p.x, p.y, p.d, 'brightness(1.7) sepia(0.6) saturate(2)', 0.12 + i * 0.08));
    }
    const hb = f.hurtbox();
    ctx.save();
    if (f.dust) {                                                 // 砂になって上から崩れていく
      const cut = f.y - 220 + Math.max(0, Math.min(1, (f.dust - 30) / 70)) * 240;
      ctx.beginPath(); ctx.rect(-W, cut, W * 3, H * 2); ctx.clip();
      if (f.dust >= 100) { ctx.restore(); return; }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(f.x, GROUND + 4, 34, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, -godLift(f));                                // 神：いつも宙に浮いている
    if (f.sinkDepth > 0) {                                        // 砂：蟻地獄に沈む（地面より下は見えない）
      ctx.beginPath(); ctx.rect(-W * 2, -H * 2, W * 5, GROUND + 6 + H * 2); ctx.clip();
      ctx.translate(f.x, 0); ctx.rotate(Math.sin(f.t * 0.6) * 0.04); ctx.translate(-f.x, f.sinkDepth);
    }
    if (f.fx === 'drunk') { ctx.translate(f.x, f.y); ctx.rotate(Math.sin(f.t * 0.08) * 0.14); ctx.translate(-f.x, -f.y); }
    if (f.laugh > 0) ctx.translate(rand(-2, 2), rand(-2, 2));
    // ダウン中は横に倒れる。起き上がり直後は点滅
    if (f.down > 0) {
      const k = Math.min(1, ((f.downMax || f.down) - f.down) / 6 + 0.15, f.down / 8);
      ctx.translate(f.x, f.y); ctx.rotate(-f.facing * Math.PI / 2 * k); ctx.translate(-f.x, -f.y);
    }
    if (f.wake > 0 && f.wake % 4 < 2) ctx.globalAlpha = 0.5;
    if (f.invis > 0) ctx.globalAlpha = f.fx === 'ghost' ? 0.3 : 0.15;          // 消：透明（霊は少し見える）                      // 消：透明
    if (f.squash > 0) { ctx.translate(f.x, f.y); ctx.scale(1.4, 0.45); ctx.translate(-f.x, -f.y); }   // 象：ぺちゃんこ
    if (f.swoon > 0) { ctx.translate(f.x, f.y); ctx.scale(1, 0.7); ctx.translate(-f.x, -f.y); }        // 尊：崩れ落ちる
    if (f.weapon.cloud) {                                         // 雲：足元に雲
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = '#b8c8d8'; ctx.lineWidth = 2;
      for (const [dx, dy, r] of [[-26, 4, 18], [0, 0, 24], [26, 4, 18]]) { ctx.beginPath(); ctx.arc(f.x + dx, f.y + 6 + dy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }

    drawCapsuleBody(f);
    // 状態の色は体の色に混ぜて描く（bodyColors）。ここでは何もしない
    const tint = () => {};
    if (f.frozen > 0) tint('rgba(140,200,255,0.5)');
    if (f.stunned > 0 && f.stunned % 6 < 3) tint('rgba(255,230,0,0.45)');
    if (f.timestop > 0) tint('rgba(90,90,110,0.45)');
    if (f.poison > 0 && !f.bugs) tint('rgba(155,77,202,0.12)');
    if (f.slip > 0) tint('rgba(90,160,230,0.15)');
    if (f.sticky > 0) tint('rgba(240,230,200,0.45)');
    if (f.curse > 0) tint('rgba(91,42,134,0.12)');
    // 拘束：鎖（体に巻きついた鎖と、持ち主の手から伸びる鎖）
    if (f.bound > 0 && f.boundKind === 'chain') {
      ctx.save();
      const link = (x, y, ang) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#d6d6d6'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      };
      // 体に3周巻きつく（巻きつく途中も見えるよう、最初の数フレームで1周ずつ増える）
      const turns = Math.min(3, Math.ceil((30 - f.bound + 1) / 3));
      for (let r = 0; r < turns; r++) {
        const cy = hb.y + 30 + r * 32;
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI;                                    // 前側の半周だけ描く
          link(f.x + Math.cos(a) * 34, cy + Math.sin(a) * 9 - 4, i % 2 ? Math.PI / 2 : -0.3);
        }
      }
      // 持ち主の手から相手までの鎖
      const by = f.boundBy;
      if (by && by.hp > 0) {
        const g = by.weaponGeom(), tx = f.x, ty = hb.y + 60, n = Math.max(4, Math.round(Math.hypot(tx - g.hx, ty - g.hy) / 16));
        for (let i = 1; i < n; i++) {
          const k = i / n, sag = Math.sin(k * Math.PI) * 18;
          link(g.hx + (tx - g.hx) * k, g.hy + (ty - g.hy) * k + sag, Math.atan2(ty - g.hy, tx - g.hx) + (i % 2 ? Math.PI / 2 : 0));
        }
      }
      ctx.restore();
    }
    // 拘束：蛇・網・糸
    if (f.bound > 0 && f.boundKind === 'coil') drawSnakeCoil(f.x, f.y - 8, f.y - 128, 36, 3.2, 11, Math.min(1, (60 - f.bound + 1) / 10), f.t, 1);   // 蛇：本物の蛇が巻きつく
    if (f.bound > 0 && !['chain', 'superchain', 'nigiri', 'sand', 'coil', 'supercoil'].includes(f.boundKind)) {
      ctx.save();
      const col = f.boundKind === 'coil' ? '#3a8a3a' : f.boundKind === 'net' ? '#555' : '#eee';
      ctx.strokeStyle = col; ctx.lineWidth = f.boundKind === 'coil' ? 7 : 2.5;
      if (f.boundKind === 'net') {
        for (let i = 0; i <= 4; i++) {
          ctx.beginPath(); ctx.moveTo(hb.x - 6 + i * (hb.w + 12) / 4, hb.y - 6); ctx.lineTo(hb.x - 6 + i * (hb.w + 12) / 4, hb.y + hb.h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(hb.x - 6, hb.y - 6 + i * (hb.h + 6) / 4); ctx.lineTo(hb.x + hb.w + 6, hb.y - 6 + i * (hb.h + 6) / 4); ctx.stroke();
        }
      } else {
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(f.x, hb.y + 25 + i * 26, 34, 9, 0.15, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.restore();
    }
    // 雪だるま
    if (f.snow > 0) drawSnowman(f.x, f.y, f.facing, f.t);
    // 草：足元に草が生える
    if (f.grass > 0) {
      ctx.save(); ctx.fillStyle = '#2a8a2a'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
      for (let i = 0; i < f.grass; i++) ctx.fillText('ww', f.x - 30 + i * 15, GROUND - 2);
      ctx.restore();
    }

    const g = f.weaponGeom(), s = f.shoulder(), gs = f.gripShift && clearOfBody(f, g, f.gripShift);
    ctx.save();
    if (gs) ctx.translate(gs.x, gs.y);                         // 3Dのキャラ：字を拳のすぐ先へ寄せて描く
    if (f.fx === 'split' && f.splits > 0) {                      // 分：分裂した字が後ろに並ぶ
      ctx.save(); ctx.globalAlpha = 0.45;
      for (let i = 1; i <= f.splits; i++) drawWeaponGlyph(f.weapon, g.cx - f.facing * 18 * i, g.cy - 14 * i, f.weapon.size * 0.6, g.rot);
      ctx.restore();
    }
    drawCapsuleArm(f, s, g);
    let size = f.weapon.size * (f.giant || 1);
    const st = f.stretchAmt();
    let stretched = false;
    if (st > 0.05 && f.fx !== 'slurp') {                        // 伸：字そのものが手元から先までびよーんと伸びる
      const dx = g.cx - g.hx, dy = g.cy - g.hy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const ex = g.cx + ux * size * 0.5, ey = g.cy + uy * size * 0.5;            // 字の先
      const mx = g.cx + ((g.hx + ex) / 2 - g.cx) * st, my = g.cy + ((g.hy + ey) / 2 - g.cy) * st;
      const sx = 1 + ((len + size * 0.5) / size - 1) * st, ang = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang); ctx.scale(Math.max(1, sx), 1 - 0.15 * st); ctx.rotate(-ang);
      drawWeaponGlyph(f.weapon, 0, 0, size, g.rot);
      ctx.restore(); stretched = true;
    } else if (st > 0.05) {                                      // 麺：手から字まで麺が伸びる
      const n = 10, dx = g.cx - g.hx, dy = g.cy - g.hy, len = Math.hypot(dx, dy) || 1, px = -dy / len, py = dx / len;
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // 伸はオレンジのゴム1本、麺は黄色い麺3本
      const noodle = f.fx === 'slurp';
      const strands = noodle ? [[-6, 0], [0, 2.1], [6, 4.2]] : [[0, 0]];
      for (const [off, ph] of strands) {
        ctx.strokeStyle = noodle ? '#b8892a' : '#ff8a1f'; ctx.lineWidth = noodle ? 7 : 10 * st + 3;
        for (const pass of noodle ? [0, 1] : [0]) {
          if (pass) { ctx.strokeStyle = '#f7dc8a'; ctx.lineWidth = 4; }
          ctx.beginPath(); ctx.moveTo(g.hx + px * off, g.hy + py * off);
          for (let i = 1; i <= n; i++) {
            const k = i / n, wob = Math.sin(k * Math.PI * 4 + f.t * 0.9 + ph) * 9 * st * (1 - k * 0.6);
            ctx.lineTo(g.hx + dx * k + px * (wob + off * (1 - k)), g.hy + dy * k + py * (wob + off * (1 - k)));
          }
          ctx.stroke();
        }
      }
      ctx.restore();
      size *= 1 + 0.25 * st;
    }
    if (f.atk && f.atk.charge > 0) size *= 1 + f.atk.charge / 200 + Math.sin(f.atk.charge) * 0.02;
    if (!stretched && !f.thrown && !(f.thrownSuper > 0)) drawWeaponGlyph(f.weapon, g.cx, g.cy, size, g.rot);   // 卍を投げている間は手ぶら
    ctx.restore();

    if (DEBUG) {
      ctx.strokeStyle = 'lime'; ctx.lineWidth = 1; ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
      ctx.strokeStyle = f.atk && f.atk.t >= f.atk.su && f.atk.t < f.atk.su + f.atk.act ? 'red' : 'rgba(255,0,0,0.3)';
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // 叩きつけで割れた地面（ギザギザのひび）
  function drawCracks() {
    for (const c of cracks) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life / 30);
      ctx.strokeStyle = '#4a3416'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      let s = c.seed;
      const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      for (const dir of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(c.x, GROUND + 2);
        let x = c.x, y = GROUND + 2;
        for (let i = 0; i < 5; i++) { x += dir * (12 + rnd() * 16); y += rnd() * 10 - 2; ctx.lineTo(x, Math.max(GROUND + 1, y)); }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawTraps() {
    for (const s of smites) {                                    // 神の天罰の予告：足元の光の輪と、天から細く差す光
      if (s.t >= 40) continue;
      const k = s.t / 40;
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.5 * k; ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(s.x, GROUND + 2, 60 - 22 * k, 12 - 4 * k, 0, 0, TAU); ctx.stroke();
      const gr = ctx.createLinearGradient(0, -400, 0, GROUND);
      gr.addColorStop(0, 'rgba(255,240,160,0)'); gr.addColorStop(1, `rgba(255,240,160,${0.45 * k})`);
      ctx.fillStyle = gr; ctx.fillRect(s.x - 4 - 12 * k, -400, 8 + 24 * k, GROUND + 400);
      ctx.restore();
    }
    for (const t of traps) {
      ctx.save(); ctx.translate(t.x, GROUND + 2);
      ctx.fillStyle = '#6b6b6b'; ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 22, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c8c8c8';
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 8 - 4, -2); ctx.lineTo(i * 8, -12); ctx.lineTo(i * 8 + 4, -2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  }
  // =====================================================================
  // 見た目の演出
  //   A：字を持っているだけで出る演出（オーラ・持ち物）
  //   B：当たった瞬間の演出（HIT_FX の表）
  // =====================================================================
  function addFx(type, x, y, opt) { fxs.push({ type, x, y, t: 0, life: 24, ...(opt || {}) }); }
  const burst = (x, y, color, n, speed, ch, g) => spark(x, y, color, n, speed, { ch, g: g == null ? 0.05 : g });

  // ---- B：当たった瞬間（att が殴った側、def が殴られた側）----
  const HIT_FX = {
    burn:     (a, d, x, y) => { const blue = a.weapon.ch === '焔'; addFx('fireburst', x, y, { life: 28, h: 120, n: 9, blue }); burst(x, y, blue ? '#7ac8ff' : '#ff8a1f', 22, 7, null, -0.12); addFx('ring', x, y, { color: blue ? '#5aa0ff' : '#ff6a1a' }); sfx('fire'); },
    breath:   (a, d, x, y) => { addFx('fireburst', x, y, { life: 22, h: 80, n: 6 }); burst(x, y, '#ff8a1f', 10, 5, null, -0.1); sfx('fire'); },
    breath3:  (a, d, x, y) => { addFx('fireburst', x, y, { life: 28, h: 130, n: 10 }); burst(x, y, '#ff5a1a', 18, 7, null, -0.1); sfx('fire'); },
    freeze:   (a, d, x, y) => { addFx('shards', x, y, { life: 22, n: 12 }); burst(x, y, '#9fd4ff', 10, 6, '❄', 0.08); addFx('ring', x, y, { color: '#bfe4ff', life: 18 }); sfx('ice'); },
    stun:     (a, d, x, y) => { addFx('bolt', d.x, d.y - 80, { life: 14 }); burst(x, y, '#ffe14d', 14, 7); sfx('zap'); },
    zap:      (a, d, x, y) => { addFx('bolt', d.x, d.y - 80, { life: 14 }); burst(x, y, '#ffe14d', 14, 7); sfx('zap'); },
    heavy:    (a, d) => addFx('weight', d.x, d.y - 60, { life: 26 }),
    god:      (a, d) => { addFx('pillar', d.x, d.y, { color: '255,230,120', life: 40, wide: 1.6 }); burst(d.x, d.y - 100, '#fff6a0', 16, 6, '✦', -0.03); },
    poison:   (a, d, x, y) => burst(x, y, '#9b4dca', 10, 3, '○', -0.05),
    sleep:    (a, d) => burst(d.x, d.y - 140, '#557', 5, 2, 'Z', -0.05),
    laugh:    (a, d, x, y) => burst(x, y, '#2a8a2a', 12, 6, 'w', 0.08),
    charm:    (a, d, x, y) => burst(x, y, '#ff5b9a', 10, 5, '♥', -0.02),
    love:     (a, d, x, y) => burst(x, y, '#ff5b9a', 8, 4, '♥', -0.02),
    timestop: (a, d) => addFx('clock', d.x, d.y - 90, { life: 40 }),
    spicy:    (a, d, x, y) => { addFx('fireburst', x, y, { life: 24, h: 100, n: 8 }); burst(x, y, '#e22', 16, 7, null, -0.12); addFx('ring', x, y, { color: '#ff3b14' }); sfx('fire'); },
    rage:     (a, d) => addFx('anger', a.x + a.facing * 18, a.y - 150, { life: 26 }),
    luck:     (a, d, x, y) => addFx('omikuji', x, y - 60, { life: 50 }),
    pierce:   (a, d, x, y) => addFx('ripple', x, y, { color: '#999' }),
    crit:     (a, d, x, y) => { addFx('crescent', x, y, { dir: a.facing, life: 14, size: 1.3, rot: -0.5 }); sfx('slash'); },
    fist:     (a, d, x, y) => addFx('ring', x, y, { color: '#ffffff', life: 12 }),
    magnet:   (a, d, x, y) => burst(x, y, '#5aa0ff', 10, 5),
    wind:     (a, d) => addFx('swirl', d.x, d.y - 80, { life: 26 }),
    cat:      (a, d) => addFx('claw', d.x, d.y - 90, { life: 24 }),
    claw:     (a, d) => addFx('claw', d.x, d.y - 90, { life: 24 }),
    bite:     (a, d) => addFx('teeth', d.x, d.y - 90, { life: 30 }),
    fangs:    (a, d) => addFx('teeth', d.x, d.y - 90, { life: 30 }),
    drunk:    (a, d, x, y) => burst(x, y, '#ffffff', 8, 3, '°', -0.05),
    flash:    (a, d, x, y) => { burst(x, y, '#fff6a0', 12, 8, '✦', 0); addFx('ring', x, y, { color: '#fff6a0', life: 16 }); },
    dark:     (a, d, x, y) => burst(x, y, '#222', 20, 5, null, -0.03),
    combo3:   (a, d, x, y) => { addFx('crescent', x, y, { dir: a.facing, life: 12, size: 1, rot: -0.6 }); sfx('slash'); },
    mow:      (a, d, x, y) => { addFx('crescent', x, y, { dir: a.facing, life: 16, size: 1.8, flat: true }); sfx('slash'); },
    iai:      (a, d, x, y) => { addFx('crescent', x, y, { dir: a.facing, life: 20, size: 2.4, flat: true }); match.flash = Math.max(match.flash, 6); sfx('slash'); },
    spear:    (a, d, x, y) => addFx('thrust', x, y, { dir: a.facing, life: 12 }),
    bleed:    (a, d, x, y) => { addFx('crescent', x, y, { dir: a.facing, life: 14, size: 1.1, rot: 0.5 }); burst(x, y, '#c0392b', 14, 5); sfx('slash'); },
    stretch:  (a, d, x, y) => addFx('ring', x, y, { color: '#ff8a1f' }),
    chain:    (a, d, x, y) => burst(x, y, '#aaa', 10, 5),
    gun:      (a, d, x, y) => burst(x, y, '#ffd84d', 5, 4),
    magic:    (a, d) => addFx('circle', d.x, d.y, { life: 30, color: '#a050ff' }),
    slip:     (a, d, x, y) => { addFx('splash', x, y, { life: 24 }); burst(x, y, '#5aa0e0', 14, 6, null, 0.25); sfx('water'); },
    dizzy:    (a, d, x, y) => burst(x, y, '#ffd000', 8, 5, '★', 0.05),
    sand:     (a, d, x, y) => burst(x, y, '#c9a36b', 24, 6, null, 0.05),
    wave:     (a, d, x, y) => { addFx('splash', x, y, { life: 26 }); burst(x, y, '#5aa0e0', 18, 8, null, 0.3); sfx('water'); },
    flower:   (a, d, x, y) => burst(x, y, '#ff7eb6', 10, 5, '✿', 0.02),
    coil:     (a, d, x, y) => addFx('ring', x, y, { color: '#3a8a3a' }),
    net:      (a, d, x, y) => addFx('ring', x, y, { color: '#777' }),
    thread:   (a, d, x, y) => addFx('ring', x, y, { color: '#ffffff' }),
    sting:    (a, d, x, y) => addFx('thrust', x, y, { dir: a.facing, life: 10, color: '#222', thin: true }),
    bugs:     (a, d, x, y) => burst(x, y, '#222', 16, 4, null, 0),
    rush:     (a, d) => { burst(d.x, d.y - 4, '#c9a36b', 20, 7); addFx('ring', d.x, d.y - 60, { color: '#8a6a3a' }); },
    stomp:    (a, d) => { burst(d.x, d.y - 4, '#c9a36b', 20, 7); addFx('ripple', d.x, d.y - 10, { color: '#8a6a3a' }); },
    dive:     (a, d, x, y) => burst(x, y, '#ffffff', 8, 5, '〃', 0.1),
    beast:    (a, d) => addFx('claw', d.x, d.y - 90, { life: 22 }),
    sticky:   (a, d, x, y) => burst(x, y, '#f4ecd2', 14, 4, null, 0.15),
    slurp:    (a, d) => addFx('noodle', 0, 0, { a, b: d, life: 20 }),
    dual:     (a, d, x, y) => { addFx('crescent', x, y, { dir: a.facing, life: 12, size: 1, rot: -0.6 }); addFx('crescent', x, y, { dir: -a.facing, life: 12, size: 1, rot: 0.6 }); sfx('slash'); },
    split:    (a, d, x, y) => addFx('slash', x, y, { dir: a.facing, color: '#ffd84d', life: 12 }),
    mystery:  (a, d, x, y) => burst(x, y, '#555', 6, 4, '？', -0.02),
    bell:     (a, d, x, y) => addFx('ripple', x, y, { color: '#d8b04a', life: 28 }),
    curse:    (a, d, x, y) => burst(x, y, '#5b2a86', 18, 3, null, -0.06),
    slow:     (a, d, x, y) => addFx('ring', x, y, { color: '#999', life: 30 }),
    grass:    (a, d, x, y) => burst(x, y, '#2a8a2a', 8, 5, 'w', 0.1),
    swoon:    (a, d) => { if (d.swoon > 0) addFx('pillar', d.x, d.y, { color: '255,160,210', life: 50 }); },
    oshi:     (a, d, x, y) => burst(x, y, '#ff5b9a', 6, 4, '♡', -0.02),
    gloom:    (a, d) => burst(d.x, d.y - 160, '#557', 6, 1.5, '…', -0.02),
    boomerang:(a, d, x, y) => addFx('slash', x, y, { dir: a.facing, color: '#ff6a5a', life: 12 }),
    gold:     () => {},
    explode:  (a, d, x, y) => addFx('explosion', x, y, { life: 34, r: 120 }),
    cannon:   (a, d, x, y) => addFx('explosion', x, y, { life: 30, r: 90 }),
    snow:     (a, d, x, y) => { addFx('shards', x, y, { life: 20, n: 8 }); burst(x, y, '#ffffff', 12, 6, '❄', 0.05); sfx('ice'); },
  };
  function hitFx(att, def, fx, hx, hy) {
    const f = HIT_FX[fx];
    if (f) f(att, def, hx, hy);
  }

  // 炎の舌（下が赤、上が黄色く消える）。blue で青い炎
  const FIRE = ['rgba(210,25,5,0.92)', 'rgba(255,110,15,0.88)', 'rgba(255,200,60,0)'];
  const FIRE_CORE = ['rgba(255,170,20,0.95)', 'rgba(255,235,120,0.9)', 'rgba(255,255,220,0)'];
  const BLUE_FIRE = ['rgba(20,60,220,0.92)', 'rgba(70,160,255,0.88)', 'rgba(200,240,255,0)'];
  const BLUE_CORE = ['rgba(120,200,255,0.95)', 'rgba(220,245,255,0.9)', 'rgba(255,255,255,0)'];
  // 外側の赤い炎＋内側の黄色い芯（明るい背景でも炎に見えるよう、足し算で重ねない）
  function fire2(x, y, h, w, t, blue) {
    flame(x, y, h, w, t, blue ? BLUE_FIRE : FIRE);
    flame(x, y, h * 0.6, w * 0.55, t + 3, blue ? BLUE_CORE : FIRE_CORE);
  }
  function flame(x, y, h, w, t, cols) {
    const c = cols || FIRE, sway = Math.sin(t * 0.35 + x * 0.07) * w * 0.5;
    const g = ctx.createLinearGradient(x, y, x, y - h);
    g.addColorStop(0, c[0]); g.addColorStop(0.45, c[1]); g.addColorStop(1, c[2]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w * 1.1, y - h * 0.55, x + sway, y - h);
    ctx.quadraticCurveTo(x + w * 1.1, y - h * 0.55, x + w, y); ctx.closePath(); ctx.fill();
  }
  // 星形（当たった瞬間の光）
  function star(x, y, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, r = i % 2 ? r2 : r1; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }
  // 状態の見た目（燃えている・凍っている・しびれている）
  function drawStatus(f) {
    if (f.dust) return;
    ctx.save();
    if (f.burn > 0) {                                            // 体が燃える
      const k = Math.min(1, f.burn / 60), blue = f.burnBy === '焔';
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < 7; i++) {
        const x = f.x + (i - 3) * 11 + Math.sin(f.t * 0.2 + i) * 4;
        fire2(x, f.y - 10 - (i % 2) * 30, (40 + (i % 3) * 22 + Math.sin(f.t * 0.5 + i * 2) * 10) * k, 11, f.t + i * 7, blue);
      }
    }
    if (f.frozen > 0) {                                          // 氷のかたまりに閉じこめられる
      const a = Math.min(1, f.frozen / 15);
      ctx.globalAlpha = 0.55 * a;
      ctx.fillStyle = '#cfeaff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath();
      const pts = [[-48, 0], [-55, -70], [-38, -150], [0, -172], [40, -148], [56, -80], [46, 0]];
      for (const [px, py] of pts) ctx.lineTo(f.x + px, f.y + py);
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 0.9 * a; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(f.x - 30, f.y - 140); ctx.lineTo(f.x - 10, f.y - 60); ctx.moveTo(f.x + 22, f.y - 150); ctx.lineTo(f.x + 34, f.y - 110); ctx.stroke();
    }
    if (f.gloom > 0 && f.hp > 0) {                               // 鬱：足元がどんより、顔に縦線
      const lv = f.gloom, top = f.y - (f.down > 0 ? 80 : 185);
      ctx.globalAlpha = 0.18 + 0.07 * lv; ctx.fillStyle = '#2a3048';
      ctx.beginPath(); ctx.ellipse(f.x, GROUND + 3, 42 + 8 * lv, 11, 0, 0, TAU); ctx.fill();
      if (f.sighT > 0 && f.down <= 0) {                          // ため息の白いもや：口元から前へ出て、下へ落ちながら消える
        const t = SIGH_LEN - f.sighT, mx = f.x + f.facing * 24, my = f.y - 118;   // 口のあたり
        for (let i = 0; i < 5; i++) {
          const pt = t - i * 5;
          if (pt < 0) continue;
          const a = 0.6 * Math.max(0, 1 - pt / 50);
          if (a <= 0) continue;
          const r = (5 + pt * 0.35) * (0.8 + 0.12 * lv);
          ctx.globalAlpha = a; ctx.fillStyle = '#eef2fa'; ctx.strokeStyle = 'rgba(150,160,185,0.8)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(mx + f.facing * (6 + pt * 0.7), my + pt * 0.45 + i * 2, r, 0, TAU); ctx.fill(); ctx.stroke();
        }
      }
      if (f.down <= 0) {                                         // ガーン…の縦線
        ctx.globalAlpha = 0.3 + 0.15 * lv; ctx.strokeStyle = '#3a3a7a'; ctx.lineWidth = 2;
        for (let i = 0; i < 2 + lv; i++) { const x = f.x - 22 + i * 44 / (1 + lv); ctx.beginPath(); ctx.moveTo(x, top + 40); ctx.lineTo(x, top + 64 + (i % 2) * 10); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
    if (f.stunned > 0 && f.t % 6 < 3) {                          // しびれ：体に電気が走る
      ctx.strokeStyle = '#fff59a'; ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 12; ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath(); let x = f.x + rand(-30, 30), y = f.y - rand(10, 160); ctx.moveTo(x, y);
        for (let i = 0; i < 4; i++) { x += rand(-25, 25); y += rand(-25, 25); ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- B の絵 ----
  // back: true なら体の後ろに描くもの（巨大な花など）、false ならそれ以外
  function drawFxs(back) {
    for (const e of fxs) {
      if (!!e.back !== !!back) continue;
      const p = e.t / e.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * p);
      // 必殺技用：同じ絵を大きく（big は2倍、wide は横だけ）
      if (e.big) { ctx.translate(e.x, e.y); ctx.scale(2, 2); ctx.translate(-e.x, -e.y); }
      if (e.wide) { ctx.translate(e.x, 0); ctx.scale(e.wide, 1); ctx.translate(-e.x, 0); }
      switch (e.type) {
        case 'impact': {                                  // 当たった瞬間の光の星
          const s = e.size * (0.5 + Math.min(1, e.t / 3) * 0.7);
          ctx.globalAlpha = Math.max(0, 1 - p);
          ctx.fillStyle = e.color; ctx.shadowColor = e.color; ctx.shadowBlur = 18;
          star(e.x, e.y, s, s * 0.28, 8, e.t * 0.2 + (e.x % 7)); ctx.fill();
          ctx.fillStyle = '#ffffff'; star(e.x, e.y, s * 0.5, s * 0.15, 8, 0.4); ctx.fill();
          break;
        }
        case 'fireburst': {                               // 炎：当たった所から火柱が噴き出す
          const n = e.n || 8, h = (e.h || 90) * Math.sin(Math.min(1, p * 1.6) * Math.PI / 2) * (1 - p * 0.6);
          for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.6;
            const x = e.x + Math.cos(a) * 18 * (i % 2 ? 1 : 0.6), y = e.y + 20;
            fire2(x + (i - n / 2) * 6, y, h * (0.6 + (i % 3) * 0.25), 12 + (i % 2) * 6, e.t + i * 5, e.blue);
          }
          break;
        }
        case 'flamepillar': {                             // 必殺・炎：画面の上まで届く火柱
          const grow = Math.min(1, e.t / 10), fade = Math.min(1, (e.life - e.t) / 20);
          ctx.globalAlpha = fade;
          for (let i = 0; i < 14; i++) {
            const x = e.x + (i - 6.5) * 15 + Math.sin(e.t * 0.3 + i) * 6;
            fire2(x, e.y + 5, (240 + ((i * 7) % 4) * 70) * grow, 24, e.t + i * 9, e.blue);
          }
          for (let i = 0; i < 3; i++) if (Math.random() < 0.6) spark(e.x + rand(-80, 80), e.y - rand(0, 260), Math.random() < 0.5 ? '#ffd84d' : '#ff6a1a', 1, 2, { vy: -3, g: -0.05 });
          break;
        }
        case 'shards': {                                  // 氷のかけらが飛び散る
          ctx.fillStyle = 'rgba(210,240,255,0.95)'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          const n = e.n || 10, sz = e.size || 1;
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + (e.x % 3), d = (14 + p * 90) * sz * (0.6 + (i % 3) * 0.25);
            const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d, s = (12 - p * 6) * sz;
            ctx.save(); ctx.translate(x, y); ctx.rotate(a + e.t * 0.2);
            ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.4, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.4, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case 'iceblock': {                                // 必殺・氷：大きな氷の結晶
          const d = e.ref, fade = Math.min(1, (e.life - e.t) / 15);
          ctx.globalAlpha = 0.6 * fade; ctx.strokeStyle = '#ffffff'; ctx.fillStyle = 'rgba(190,230,255,0.6)'; ctx.lineWidth = 3;
          for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + (i - 2.5) * 0.45, len = 120 + (i % 2) * 60;
            ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(a + Math.PI / 2);
            ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(0, -len); ctx.lineTo(14, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case 'crescent': {                                // 斬撃の三日月
          const s = 60 * (e.size || 1) * (0.7 + p * 0.5);
          ctx.translate(e.x, e.y); ctx.rotate(e.rot || 0); ctx.scale(e.dir, e.flat ? 0.35 : 1);
          ctx.fillStyle = e.color || '#ffffff'; ctx.shadowColor = e.color || '#9fd8ff'; ctx.shadowBlur = 20;
          ctx.beginPath(); ctx.arc(0, 0, s, -1.3, 1.3); ctx.arc(-s * 0.35, 0, s * 0.9, 1.2, -1.2, true); ctx.closePath(); ctx.fill();
          break;
        }
        case 'splash': {                                  // 水しぶき
          ctx.fillStyle = 'rgba(90,160,230,0.85)';
          for (let i = 0; i < 12; i++) {
            const a = -Math.PI / 2 + (i / 11 - 0.5) * 2.4, d = 10 + p * 80 * (0.6 + (i % 3) * 0.3);
            const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d + p * p * 60;
            ctx.beginPath(); ctx.arc(x, y, 7 * (1 - p) + 2, 0, TAU); ctx.fill();
          }
          break;
        }
        case 'bigwave': {                                 // 必殺・水：画面の端から端まで大波
          const x = e.dir > 0 ? -100 + p * (W + 300) : W + 100 - p * (W + 300);
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const g = ctx.createLinearGradient(0, GROUND - 260, 0, GROUND);
          g.addColorStop(0, 'rgba(120,200,255,0.9)'); g.addColorStop(1, 'rgba(30,90,180,0.85)');
          ctx.fillStyle = g; ctx.beginPath();
          ctx.moveTo(x - e.dir * 600, GROUND); ctx.lineTo(x - e.dir * 600, GROUND - 160);
          ctx.quadraticCurveTo(x - e.dir * 120, GROUND - 200, x, GROUND - 250);
          ctx.quadraticCurveTo(x + e.dir * 60, GROUND - 230, x + e.dir * 30, GROUND - 170);
          ctx.quadraticCurveTo(x + e.dir * 90, GROUND - 60, x + e.dir * 40, GROUND); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffffff'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + e.dir * rand(-20, 40), GROUND - 240 + rand(0, 40), rand(4, 9), 0, TAU); ctx.fill(); }
          break;
        }
        case 'explosion': {                               // 爆発：火の玉と煙の輪
          const r = e.r * Math.min(1, e.t / 8);
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
          g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(0.35, 'rgba(255,190,60,0.95)'); g.addColorStop(0.7, 'rgba(255,80,20,0.7)'); g.addColorStop(1, 'rgba(120,20,0,0)');
          ctx.globalAlpha = Math.max(0, 1 - p * 1.2); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.max(0, 0.6 - p * 0.6);
          ctx.strokeStyle = 'rgba(80,70,60,0.8)'; ctx.lineWidth = 18 * (1 - p);
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.6 + p * 0.8), 0, TAU); ctx.stroke();
          break;
        }
        case 'beam': {                                    // 必殺・突き：画面を貫く光線
          const w = 40 * (1 - p) + 6;
          ctx.globalCompositeOperation = 'lighter';
          const x2 = e.dir > 0 ? W + 200 : -200;
          ctx.fillStyle = 'rgba(255,230,140,0.8)'; ctx.fillRect(Math.min(e.x, x2), e.y - w / 2, Math.abs(x2 - e.x), w);
          ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(Math.min(e.x, x2), e.y - w / 5, Math.abs(x2 - e.x), w / 2.5);
          break;
        }
        case 'eyes': {                                    // 必殺・闇：暗闇に光る目
          ctx.fillStyle = '#ff2020'; ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 20;
          for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(e.x + s * 34, e.y - 60, 16, 6, s * 0.25, 0, TAU); ctx.fill(); }
          break;
        }
        case 'spikes': {                                  // 必殺・大地：岩のトゲが突き出す
          const h = 150 * Math.min(1, e.t / 6);
          ctx.fillStyle = '#7a5a3a'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3;
          for (let i = -3; i <= 3; i++) {
            const x = e.x + i * 34, hh = h * (1 - Math.abs(i) * 0.18);
            ctx.beginPath(); ctx.moveTo(x - 20, e.y); ctx.lineTo(x + (i % 2) * 6, e.y - hh); ctx.lineTo(x + 20, e.y); ctx.closePath(); ctx.fill(); ctx.stroke();
          }
          break;
        }
        case 'cloud': {                                   // 必殺・毒：もくもくの毒ガス
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 20) * 0.7;
          for (let i = 0; i < 9; i++) {
            const a = i * 0.7 + e.t * 0.02, r = 40 + (i % 3) * 14 + p * 40;
            ctx.fillStyle = `rgba(${e.color},${0.35 + (i % 2) * 0.2})`;
            ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 60 * (0.5 + p), e.y + Math.sin(a) * 40, r, 0, TAU); ctx.fill();
          }
          break;
        }
        case 'vignette': {                                // 必殺・闇／滅：相手のまわりだけ闇に包む
          const k = Math.min(1, e.t / 8) * Math.min(1, (e.life - e.t) / 15);
          ctx.globalAlpha = 1;
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 300);
          g.addColorStop(0, `rgba(${e.color},${0.85 * k})`); g.addColorStop(0.55, `rgba(${e.color},${0.6 * k})`); g.addColorStop(1, `rgba(${e.color},0)`);
          ctx.fillStyle = g; ctx.fillRect(e.x - 300, e.y - 300, 600, 600);
          break;
        }
        case 'kuji': {                                    // 必殺・運：「大吉」のおみくじが飛んでくる
          const k = Math.min(1, e.t / 7), r = (e.final ? 380 : 320) * (1 - k * k), sc = e.final ? 3.4 : 1.7;
          ctx.globalAlpha = e.t < 7 ? 1 : Math.max(0, 1 - (e.t - 7) / (e.final ? 18 : 6));
          ctx.translate(e.x + Math.cos(e.a) * r, e.y + Math.sin(e.a) * r * 0.7); ctx.rotate(e.rot0 * (1 - k) + (e.final ? 0 : e.a * 0.2)); ctx.scale(sc, sc);
          ctx.fillStyle = '#fffdf4'; ctx.strokeStyle = '#d33'; ctx.lineWidth = 3;
          ctx.fillRect(-17, -40, 34, 80); ctx.strokeRect(-14, -37, 28, 74);
          ctx.fillStyle = '#d33'; ctx.font = '900 22px "Noto Sans JP", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('大', 0, -13); ctx.fillText('吉', 0, 13);
          break;
        }
        case 'petalswirl': {                              // 必殺・薔：花びらの渦
          ctx.globalAlpha = Math.min(1, e.t / 8, (e.life - e.t) / 15);
          for (let i = 0; i < 46; i++) {
            const a = i * 0.55 + e.t * (0.12 + (i % 3) * 0.03), r = 40 + (i * 37 % 150) * (0.6 + 0.4 * Math.sin(e.t * 0.05 + i));
            ctx.save(); ctx.translate(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * 0.75); ctx.rotate(a * 2);
            ctx.fillStyle = ['#e8336d', '#c81d4e', '#ff7eb6'][i % 3]; ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, TAU); ctx.fill(); ctx.restore();
          }
          break;
        }
        case 'ironfist': {                                // 必殺・鉄：巨大な鉄の拳が降ってくる（こぶしが下向き）
          const k = Math.min(1, e.t / 12), fall = k * k, by = e.y - (1 - fall) * 760;   // by = こぶしの下の端
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12);
          if (k < 1) {                                     // 落ちてくる線
            ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 4;
            for (let i = 0; i < 6; i++) { const x = e.x - 75 + i * 30; ctx.beginPath(); ctx.moveTo(x, by - 330 - (i % 2) * 40); ctx.lineTo(x, by - 470 - (i % 3) * 50); ctx.stroke(); }
          }
          ctx.translate(e.x, by); const sq = e.t >= 12 ? 1 + Math.max(0, 0.12 - (e.t - 12) * 0.03) : 1; ctx.scale(1.25 * sq, 1.25 / sq);
          const g = ctx.createLinearGradient(-80, 0, 80, 0);
          g.addColorStop(0, '#5a6474'); g.addColorStop(0.35, '#e8eef4'); g.addColorStop(0.6, '#a2adbb'); g.addColorStop(1, '#3e4652');
          const box = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke(); };
          ctx.fillStyle = g; ctx.strokeStyle = '#1a1f26'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
          box(-42, -250, 84, 120, 10);                     // 腕
          ctx.fillStyle = '#6a7484'; box(-50, -150, 100, 26, 6);   // 袖口の金具
          ctx.fillStyle = '#2a3038'; for (const x of [-34, 0, 34]) { ctx.beginPath(); ctx.arc(x, -137, 4, 0, TAU); ctx.fill(); }
          ctx.fillStyle = g; box(-66, -128, 132, 100, 22);   // こぶし
          for (const x of [-49, -16, 17, 50]) box(x - 16, -46, 32, 46, 14);   // 指（下向き）
          ctx.fillStyle = g; box(-84, -112, 30, 70, 14);    // 親指
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-40, -118); ctx.lineTo(-20, -40); ctx.stroke();   // 光
          if (e.t >= 12 && !e.landed) { e.landed = true; shake = Math.max(shake, 26); spark(e.x, GROUND - 6, '#c9a36b', 36, 11); spark(e.x, GROUND - 40, '#ffd84d', 18, 9); }
          break;
        }
        case 'arrowfall': {                               // 必殺・弓：空から降ってきて地面に刺さる矢
          const k = Math.min(1, e.t / 8), dx = Math.sin(e.tilt), dy = Math.cos(e.tilt);
          const x = e.x - dx * (1 - k) * 560, y = e.y - dy * (1 - k) * 560;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx)); ctx.scale(1.3, 1.3);
          ctx.strokeStyle = '#5a3b1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(8, 0); ctx.stroke();
          if (k < 1) { ctx.fillStyle = '#888'; ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(4, -7); ctx.lineTo(4, 7); ctx.fill(); }   // 刺さったら矢じりは地面の中
          ctx.fillStyle = '#d33'; ctx.fillRect(-35, -5, 8, 10);
          if (k >= 1 && !e.landed) { e.landed = true; spark(e.x, e.y, '#c9a36b', 4, 3); }
          break;
        }
        case 'billslap': {                                // 必殺・金：大きな札束ではたく
          const k = Math.min(1, e.t / 6), ease = 1 - Math.pow(1 - k, 3);
          ctx.globalAlpha = Math.max(0, 1 - Math.max(0, e.t - 6) / 6);
          for (let i = 2; i >= 0; i--) drawBill(e.x - e.dir * (50 - i * 6), e.y - i * 5, 150, 66, e.dir * (-1.4 + 1.9 * ease) + i * 0.05);
          break;
        }
        case 'shield': {                                  // 必殺・盾：巨大な盾が前へ突っ込む
          const k = Math.min(1, e.t / 14), ease = 1 - Math.pow(1 - k, 3), x = e.x + (e.tx - e.x) * ease;
          const dir = Math.sign(e.tx - e.x) || 1;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          if (k < 1) {                                     // 突っ込む線
            ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 4;
            for (let i = 0; i < 7; i++) { const y = e.y - 100 + i * 34; ctx.beginPath(); ctx.moveTo(x - dir * (90 + i % 3 * 30), y); ctx.lineTo(x - dir * (200 + i % 2 * 60), y); ctx.stroke(); }
          }
          ctx.translate(x, e.y); const sc = 1 + (e.t >= 14 ? Math.max(0, 0.15 - (e.t - 14) * 0.03) : 0); ctx.scale(sc, sc);
          ctx.beginPath(); ctx.moveTo(-80, -115); ctx.lineTo(80, -115); ctx.lineTo(80, 0); ctx.quadraticCurveTo(80, 85, 0, 125); ctx.quadraticCurveTo(-80, 85, -80, 0); ctx.closePath();
          const g = ctx.createLinearGradient(-80, -115, 80, 125); g.addColorStop(0, '#f4f7fb'); g.addColorStop(0.5, '#93a2b4'); g.addColorStop(1, '#4e5b6c');
          ctx.fillStyle = g; ctx.fill();
          ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = '#d8a020'; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = '#2a1a05'; ctx.stroke();
          Texture.draw(ctx, e.ch, 0, -4, 120, 'red');
          if (e.t >= 14 && !e.landed) { e.landed = true; addFx('ring', x + dir * 60, e.y, { color: '#ffffff', life: 18, big: true }); spark(x + dir * 70, e.y, '#ffd84d', 30, 10); shake = Math.max(shake, 20); }
          break;
        }
        case 'netdrop': {                                 // 必殺・網：大きな網が上から落ちてきて包む
          const fall = Math.min(1, e.t / 10), cx = e.ref ? e.ref.x : e.x, base = (e.ref ? e.ref.y : e.y) + 4;
          const top = base - 230 - (1 - fall) * (1 - fall) * 520, wob = e.t > 10 ? Math.sin(e.t * 0.3) * 4 * Math.max(0, 1 - (e.t - 10) / 40) : 0;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 15);
          const pt = (u, v) => { const wdt = 50 + 85 * v; return [cx + (u - 0.5) * 2 * wdt + wob * v, top + (base - top) * v + Math.sin(u * Math.PI) * 14 * v]; };
          ctx.lineCap = 'round';
          for (const [col, lw] of [['#7a5a2a', 5], ['#e8c890', 2]]) {
            ctx.strokeStyle = col; ctx.lineWidth = lw;
            for (let i = 0; i <= 8; i++) { ctx.beginPath(); for (let j = 0; j <= 10; j++) { const [x, y] = pt(i / 8, j / 10); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
            for (let j = 1; j <= 7; j++) { ctx.beginPath(); for (let i = 0; i <= 12; i++) { const [x, y] = pt(i / 12, j / 7); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
          }
          ctx.fillStyle = '#555'; for (let i = 0; i <= 6; i++) { const [x, y] = pt(i / 6, 1); ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); }
          if (e.t >= 10 && !e.landed) { e.landed = true; spark(cx, base, '#c9a36b', 20, 6); }
          break;
        }
        case 'mirrors': {                                 // 必殺・鏡：鏡が囲み、光が反射して集まる
          const pos = (i) => { const a = (i / 6) * TAU + e.t * 0.02; return [e.x + Math.cos(a) * 160, e.y + Math.sin(a) * 100]; };
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12);
          if (e.t > 10) {                                  // 反射する光
            const order = [0, 3, 1, 4, 2, 5, 0], n = Math.min(6, (e.t - 10) / 1.5);
            ctx.strokeStyle = '#ffffff'; ctx.shadowColor = '#7fe6ff'; ctx.shadowBlur = 16; ctx.lineWidth = 6; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(...pos(order[0]));
            for (let i = 1; i <= Math.floor(n); i++) ctx.lineTo(...pos(order[i]));
            ctx.stroke();
            if (e.t > 22) { ctx.lineWidth = 9; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(...pos(i)); ctx.lineTo(e.x, e.y); ctx.stroke(); } }
            ctx.shadowBlur = 0;
          }
          for (let i = 0; i < 6; i++) {
            const k = Math.min(1, Math.max(0, (e.t - i * 1.5) / 6)); if (!k) continue;
            const [x, y] = pos(i);
            ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(e.y - y, e.x - x) + Math.PI / 2); ctx.scale(k, k);
            const g = ctx.createLinearGradient(-20, -36, 20, 36); g.addColorStop(0, '#d8f4ff'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(0.55, '#9fd8ef'); g.addColorStop(1, '#5fa8c8');
            ctx.fillStyle = g; ctx.strokeStyle = '#d8a020'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.ellipse(0, 0, 32, 52, 0, 0, TAU); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, -26); ctx.lineTo(6, -38); ctx.stroke();
            ctx.restore();
          }
          if (e.t > 22 && e.t < 30) { ctx.fillStyle = `rgba(255,255,255,${0.9 - (e.t - 22) * 0.1})`; ctx.beginPath(); ctx.arc(e.x, e.y, 40 + (e.t - 22) * 8, 0, TAU); ctx.fill(); }
          break;
        }
        case 'bell': {                                    // 必殺・鐘：巨大な鐘が落ちてきて、ゴーンと鳴る
          const fall = Math.min(1, e.t / 12), bx = e.ref ? e.ref.x : e.x, by = GROUND + 6 - (1 - fall * fall) * 620;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 15);
          const ring = e.t >= 12 ? Math.sin((e.t - 12) * 0.9) * 3 * Math.max(0, 1 - (e.t - 12) / 40) : 0;
          if (e.t >= 12) {                                 // 音の波
            for (let s = 0; s < 3; s++) {
              const q = (((e.t - 12) + s * 10) % 30) / 30;
              ctx.strokeStyle = `rgba(255,220,120,${0.7 * (1 - q)})`; ctx.lineWidth = 6;
              ctx.beginPath(); ctx.ellipse(bx, by - 120, 130 + q * 170, 110 + q * 140, 0, 0, TAU); ctx.stroke();
            }
          }
          ctx.translate(bx + ring, by);
          ctx.beginPath(); ctx.moveTo(-105, 0); ctx.quadraticCurveTo(-98, -45, -72, -150); ctx.quadraticCurveTo(-62, -238, 0, -244); ctx.quadraticCurveTo(62, -238, 72, -150); ctx.quadraticCurveTo(98, -45, 105, 0); ctx.closePath();
          const g = ctx.createLinearGradient(-105, 0, 105, 0);
          g.addColorStop(0, '#4a300a'); g.addColorStop(0.3, '#b8862a'); g.addColorStop(0.45, '#f0d27a'); g.addColorStop(0.7, '#9a6a1e'); g.addColorStop(1, '#3a2405');
          ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#2a1a05'; ctx.stroke();
          ctx.strokeStyle = 'rgba(42,26,5,0.7)'; ctx.lineWidth = 5;
          for (const y of [-20, -34, -175]) { ctx.beginPath(); ctx.moveTo(-100 + (y < -100 ? 28 : 2), y); ctx.lineTo(100 - (y < -100 ? 28 : 2), y); ctx.stroke(); }
          ctx.fillStyle = '#6a4a14'; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(-45 + i * 30, -150 + j * 20, 5, 0, TAU); ctx.fill(); }
          ctx.strokeStyle = '#3a2405'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(0, -252, 14, Math.PI, 0); ctx.stroke();
          if (e.t >= 12 && !e.landed) { e.landed = true; shake = Math.max(shake, 24); spark(bx, GROUND - 4, '#c9a36b', 34, 10); }
          break;
        }
        // ---- 2026-11 に作り直した必殺技の絵（その2）----
        case 'hotpot': {                                  // 辛：激辛スープの大鍋（back：奥のふちとスープ、前：手前の鍋の壁と炎）
          const k = Math.min(1, e.t / 8), fade = Math.min(1, (e.life - e.t) / 12), rx = 130 * k, top = GROUND - 80 * k;
          ctx.globalAlpha = fade;
          if (e.back) {
            ctx.fillStyle = '#c8281a'; ctx.beginPath(); ctx.ellipse(e.x, top, rx, 22 * k, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = '#e8503a'; for (let i = 0; i < 6; i++) { const bx = e.x + Math.sin(e.t * 0.3 + i * 1.7) * rx * 0.7; ctx.beginPath(); ctx.arc(bx, top + Math.cos(i) * 6, 6 + (e.t + i * 5) % 8, 0, TAU); ctx.fill(); }
            ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 10; ctx.beginPath(); ctx.ellipse(e.x, top, rx, 22 * k, 0, Math.PI, TAU); ctx.stroke();
            break;
          }
          for (let i = 0; i < 7; i++) fire2(e.x + (i - 3) * 34, GROUND + 6, 40 + (i % 3) * 14, 16, e.t + i * 4);
          const g = ctx.createLinearGradient(e.x - rx, 0, e.x + rx, 0); g.addColorStop(0, '#1a1a1a'); g.addColorStop(0.45, '#4a4a4a'); g.addColorStop(1, '#151515');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(e.x - rx, top); ctx.ellipse(e.x, top, rx, 22 * k, 0, Math.PI, 0, true); ctx.lineTo(e.x + rx * 0.9, GROUND - 6); ctx.quadraticCurveTo(e.x, GROUND + 14, e.x - rx * 0.9, GROUND - 6); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 10; ctx.beginPath(); ctx.ellipse(e.x, top, rx, 22 * k, 0, 0, Math.PI); ctx.stroke();
          ctx.fillStyle = '#d33'; ctx.font = `900 ${Math.round(34 * k)}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(L('激辛', 'HOT'), e.x, top + 40 * k);
          if (e.t % 3 === 0) spark(e.x + rand(-rx, rx) * 0.8, top - 10, 'rgba(255,255,255,0.8)', 1, 1.5, { vy: -2, g: -0.03 });
          break;
        }
        case 'dragonshade': {                             // 竜：背後にそびえる巨大な竜の影
          const rise = Math.min(1, e.t / 10), fade = Math.min(1, (e.life - e.t) / 14);
          ctx.globalAlpha = 0.85 * fade; ctx.translate(e.x, e.y + (1 - rise) * 300); ctx.scale(e.d * 1.6, 1.6);
          const open = Math.max(0, Math.min(1, (e.t - 12) / 4)) * (e.t < 60 ? 1 : 0.4);
          drawDragon(open, e.t, '#3a0f0a', '#5a1a10');
          break;
        }
        case 'breath': {                                  // 竜：口から相手へ伸びる炎のブレス
          const k = Math.min(1, e.t / 6), fade = Math.min(1, (e.life - e.t) / 8);
          ctx.globalAlpha = fade;
          for (let i = 0; i <= 12; i++) {
            const q = i / 12 * k, x = e.x + (e.tx - e.x) * q, y = e.y + (e.ty - e.y) * q, r = 20 + q * 50;
            const g = ctx.createRadialGradient(x, y, 2, x, y, r); g.addColorStop(0, 'rgba(255,250,200,0.95)'); g.addColorStop(0.5, 'rgba(255,140,30,0.7)'); g.addColorStop(1, 'rgba(220,40,10,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + Math.sin(e.t + i) * 6, y + Math.cos(e.t * 1.3 + i) * 6, r, 0, TAU); ctx.fill();
          }
          break;
        }
        case 'firedragon': {                              // 龍：足元から昇る炎の龍
          const fade = Math.min(1, (e.life - e.t) / 12);
          ctx.globalAlpha = fade; ctx.globalCompositeOperation = 'lighter';
          const pts = [];
          for (let i = 0; i < 26; i++) { const tau = e.t - i * 0.9; if (tau < 0) break; const y = Math.max(GROUND - 520, GROUND + 20 - tau * 26); pts.push([e.x + Math.sin(tau * 0.45) * 80, y, i]); }
          for (let i = pts.length - 1; i >= 0; i--) {
            const [x, y, n] = pts[i], r = 56 - n * 1.4;
            const g = ctx.createRadialGradient(x, y, 2, x, y, r); g.addColorStop(0, 'rgba(255,245,180,0.9)'); g.addColorStop(0.5, 'rgba(255,120,30,0.7)'); g.addColorStop(1, 'rgba(200,30,10,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          if (pts.length) { const [x, y] = pts[0], [x2, y2] = pts[Math.min(2, pts.length - 1)]; ctx.translate(x, y); ctx.rotate(Math.atan2(y - y2, x - x2) + Math.PI / 2); drawDragonHead(2, '#ff7a1a', '#ffd84d', e.t); }
          break;
        }
        case 'tridragon': {                               // 龘：三つ首の龍（翼のない赤い東洋の龍）がらせんに昇る
          const rise = Math.min(1, e.t / 18), fade = Math.min(1, (e.life - e.t) / 14);
          ctx.globalAlpha = fade;
          const top = GROUND - 250 * rise, sw = Math.sin(e.t * 0.12) * 50;   // 頭が画面の上に出ない高さ
          ctx.lineCap = 'round';
          for (const [col, lw] of [['#4a0e0a', 64], ['#a8231a', 52], ['#e8a040', 14]]) {            // 胴体（らせんにうねって昇る）
            ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
            for (let j = 0; j <= 20; j++) { const q = j / 20, y = GROUND + 30 - (GROUND + 30 - top) * q, x = e.x + Math.sin(q * 7 + e.t * 0.15) * 70 * (1 - q * 0.5) + sw * q; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
            ctx.stroke();
          }
          const nx = e.x + Math.sin(7 + e.t * 0.15) * 35 + sw;
          [-1, 0, 1].forEach((k) => {                                                         // 3本の首と頭
            const hx = nx + k * 120 + Math.sin(e.t * 0.2 + k * 2) * 14, hy = top - 110 + Math.abs(k) * 40 + Math.cos(e.t * 0.25 + k) * 10;
            for (const [col, lw] of [['#4a0e0a', 40], ['#a8231a', 30]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(nx, top); ctx.quadraticCurveTo(nx + k * 70, top - 20, hx, hy); ctx.stroke(); }
            ctx.save(); ctx.translate(hx, hy); ctx.rotate(k * 0.6 - Math.PI / 2 + Math.PI / 2); drawDragonHead(1.05, '#a8231a', '#ffd84d', e.t + k * 7); ctx.restore();
          });
          break;
        }
        case 'phoenix': {                                 // 蘇：炎の不死鳥が羽ばたいて飛ぶ
          const k = Math.min(1, e.t / 30), x = e.x + (e.tx - e.x) * k, y = e.y + (e.ty - e.y) * k - Math.sin(k * Math.PI) * 120;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          ctx.translate(x, y); ctx.scale(sign(e.tx - e.x) || 1, 1); drawPhoenix(2.4, e.t);
          if (e.t % 2 === 0) spark(x, y, '#ffb030', 3, 3, { g: 0.05 });
          break;
        }
        case 'dogs': {                                    // 犬：犬の群れが駆け込んで、土けむりの中でもみくちゃ
          if (!e.ds) e.ds = Array.from({ length: e.n }, (_, i) => ({ side: i % 2 ? 1 : -1, at: 4 + i * 1.5, dx: rand(-60, 60), ph: rand(0, 6) }));
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const arrived = e.ds.filter((d) => e.t >= d.at + 6).length;
          if (arrived) {                                                                          // 土けむり
            for (let i = 0; i < 9; i++) { const a = i * 0.7 + e.t * 0.3; ctx.fillStyle = i % 2 ? 'rgba(235,225,205,0.92)' : 'rgba(215,200,175,0.92)'; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 60, GROUND - 80 + Math.sin(a) * 45, 50, 0, TAU); ctx.fill(); }
            ctx.fillStyle = '#ffd84d'; for (let i = 0; i < 4; i++) { star(e.x + Math.cos(e.t * 0.5 + i * 1.6) * 80, GROUND - 90 + Math.sin(e.t * 0.7 + i) * 60, 14, 6, 5, e.t * 0.2); ctx.fill(); }
          }
          for (const d of e.ds) {
            if (e.t < d.at + 6) { const k = Math.max(0, (e.t - d.at) / 6), x = e.x + d.side * 700 * (1 - k) + d.dx * k; ctx.save(); ctx.translate(x, GROUND - 4 - Math.abs(Math.sin(e.t * 0.8 + d.ph)) * 14); ctx.scale(-d.side, 1); drawDog(1.3, e.t); ctx.restore(); }
            else { const a = e.t * 0.35 + d.ph; ctx.save(); ctx.translate(e.x + Math.cos(a) * 75, GROUND - 70 + Math.sin(a * 1.3) * 55); ctx.rotate(Math.sin(a) * 0.8); ctx.scale(Math.cos(a) > 0 ? 1 : -1, 1); drawDog(1.1, e.t); ctx.restore(); }
          }
          break;
        }
        case 'moonnight': {                               // 狼：夜になって大きな満月が昇る
          const k = Math.min(1, e.t / 12) * Math.min(1, (e.life - e.t) / 16);
          ctx.globalAlpha = k * 0.8;
          const gr = ctx.createLinearGradient(0, -H, 0, GROUND); gr.addColorStop(0, '#0a1030'); gr.addColorStop(1, 'rgba(40,50,100,0.35)');
          ctx.fillStyle = gr; ctx.fillRect(-W, -H, W * 3, GROUND + H);
          ctx.globalAlpha = k;
          const my = 150 - Math.min(1, e.t / 12) * 40, mx = e.x;
          const mg = ctx.createRadialGradient(mx, my, 60, mx, my, 200); mg.addColorStop(0, 'rgba(255,250,210,0.6)'); mg.addColorStop(1, 'rgba(255,250,210,0)');
          ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 200, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(mx, my, 80, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(200,190,150,0.35)'; for (const [cx, cy, r] of [[-20, -15, 16], [25, 10, 12], [-5, 30, 9]]) { ctx.beginPath(); ctx.arc(mx + cx, my + cy, r, 0, TAU); ctx.fill(); }
          break;
        }
        case 'wolfleap': {                                // 狼：横から跳びかかる狼の影
          const k = Math.min(1, e.t / 8), x = e.x - e.d * 420 * (1 - k), y = e.y - 110 - Math.sin(k * Math.PI) * 140;
          ctx.globalAlpha = k < 1 ? 1 : Math.max(0, 1 - (e.t - 8) / 6);
          ctx.translate(x, y); ctx.scale(e.d, 1); ctx.rotate(-0.25 + k * 0.4); drawWolf(1.5);
          break;
        }
        case 'jaws': {                                    // 牙：地面と空から巨大な牙の口が閉じる（2回噛む）
          const bite = (t) => { const a = Math.min(1, Math.max(0, t / 8)); return a; };
          const c1 = bite(e.t), c2 = e.t > 14 ? 1 - Math.min(1, (e.t - 14) / 4) + Math.min(1, Math.max(0, (e.t - 18) / 6)) : 1;
          const close = Math.min(c1, c2), gap = 260 * (1 - close) + 10;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const cy = e.y - 90;
          drawJaw(e.x, cy + gap / 2 + 60, 1, Math.min(1, e.t / 5));
          drawJaw(e.x, cy - gap / 2 - 60, -1, Math.min(1, e.t / 5));
          break;
        }
        case 'clawtear': {                                // 爪：画面ごと裂く巨大な爪痕
          const k = Math.min(1, e.t / 4), fade = Math.min(1, (e.life - e.t) / 12), L2 = 520;
          ctx.globalAlpha = fade; ctx.translate(e.x, e.y); ctx.rotate(-0.95 + e.k * 0.05);
          ctx.beginPath(); ctx.moveTo(-L2 / 2, 0);
          for (let j = 1; j <= 10; j++) { const q = j / 10 * k; ctx.lineTo(-L2 / 2 + L2 * q, (j % 2 ? -1 : 1) * 4 - Math.sin(q * Math.PI) * 18); }
          for (let j = 10; j >= 0; j--) { const q = j / 10 * k; ctx.lineTo(-L2 / 2 + L2 * q, Math.sin(q * Math.PI) * 18 + (j % 2 ? 1 : -1) * 4); }
          ctx.closePath(); ctx.fillStyle = '#1a0505'; ctx.fill(); ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 5; ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
          break;
        }
        case 'voidhole': {                                // 無：巨大な「無」の字が回り、まわりのものが吸い込まれていく
          const k = Math.min(1, e.t / 10), fade = Math.min(1, (e.life - e.t) / 14);
          ctx.globalAlpha = 0.55 * fade;
          Texture.draw(ctx, e.w.ch, e.x, e.y, Math.round(320 * k), weaponStyle(e.w), e.t * 0.08);
          ctx.globalAlpha = 0.7 * fade; ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
          for (let i = 0; i < 8; i++) { const a0 = i * TAU / 8 + e.t * 0.1; ctx.beginPath(); for (let j = 0; j <= 12; j++) { const r = 260 * (1 - j / 12), a = a0 + j * 0.25; const x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r * 0.7; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
          if (e.t % 2 === 0) { const a = rand(0, TAU); particles.push({ x: e.x + Math.cos(a) * 260, y: e.y + Math.sin(a) * 180, vx: -Math.cos(a) * 12, vy: -Math.sin(a) * 9, g: 0, life: 20, color: '#333', r: 3 }); }
          break;
        }
        case 'ofuda': {                                   // 呪：お札が飛んできて貼りつき、最後に燃える
          const k = Math.min(1, e.t / 6), bx = e.ref ? e.ref.x : e.ox, by = e.ref ? e.ref.y : e.oy;
          const x = e.x + (bx + e.dx - e.x) * k, y = e.y + (by + e.dy - e.y) * k;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 8);
          ctx.save(); ctx.translate(x, y); ctx.rotate(e.rot + (1 - k) * 4); drawOfuda(1.2); ctx.restore();
          if (e.t > e.burnAt) fire2(x, y + 30, 50, 14, e.t);
          break;
        }
        case 'raincloud': {                               // 鬱：相手の頭上にだけかかる雨雲
          const cx = e.ref ? e.ref.x : e.x, base = e.ref ? e.ref.y : e.y, k = Math.min(1, e.t / 8), fade = Math.min(1, (e.life - e.t) / 12);
          ctx.globalAlpha = fade; const cy = base - 230 - (1 - k) * 60;
          ctx.strokeStyle = 'rgba(140,160,190,0.7)'; ctx.lineWidth = 2;
          for (let i = 0; i < 14; i++) { const x = cx - 70 + ((i * 37) % 140), y = cy + 20 + ((e.t * 14 + i * 29) % (base - cy - 20)); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 14); ctx.stroke(); }
          ctx.fillStyle = '#5a6070'; for (const [dx, dy, r] of [[-50, 6, 30], [-14, -8, 40], [30, 0, 34], [60, 10, 24]]) { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r, 0, TAU); ctx.fill(); }
          ctx.fillStyle = 'rgba(120,140,170,0.35)'; ctx.beginPath(); ctx.ellipse(cx, GROUND + 4, 70, 8, 0, 0, TAU); ctx.fill();
          break;
        }
        case 'cats': {                                    // 猫：猫の群れが飛びついて肉球パンチ
          if (!e.cs) e.cs = Array.from({ length: e.n }, (_, i) => ({ side: i % 2 ? 1 : -1, at: 2 + i * 1.2, a: i * TAU / e.n, col: ['#f0a040', '#f4f0e8', '#3a3a3a', '#c88a50'][i % 4] }));
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          for (const c of e.cs) {
            const ax = e.x + Math.cos(c.a + e.t * 0.08) * 80, ay = e.y - 100 + Math.sin(c.a + e.t * 0.08) * 70;
            const k = Math.min(1, Math.max(0, (e.t - c.at) / 6)), x = e.x + c.side * 600 * (1 - k) + (ax - e.x) * k, y = GROUND - 30 + (ay - GROUND + 30) * k - Math.sin(k * Math.PI) * 120;
            ctx.save(); ctx.translate(x, y); ctx.scale(x < e.x ? 1 : -1, 1); drawCat(1.2, c.col, Math.sin(e.t * 0.9 + c.a) > 0.3, e.t); ctx.restore();
          }
          break;
        }
        case 'bottle': {                                  // 酔：上から酒瓶が落ちてきて、頭で割れる
          const k = Math.min(1, e.t / 9), y = e.y - (1 - k) * 400;
          if (e.t < 9) { ctx.translate(e.x, y); ctx.rotate(e.t * 0.7); drawBottle(1.6); }
          else { ctx.globalAlpha = Math.max(0, 1 - (e.t - 9) / 20); ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(e.x + Math.cos(i) * 40, e.y - 10 + Math.sin(i * 2) * 20 - (e.t - 9) * 1.5, 14 + (i % 3) * 5, 0, TAU); ctx.fill(); } }
          break;
        }
        case 'tracer': {                                  // 銃：弾の軌跡
          ctx.globalAlpha = 1 - p; ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 4; ctx.shadowColor = '#ffb030'; ctx.shadowBlur = 10;
          const k = Math.min(1, (e.t + 1) / 2), x = e.x + (e.x2 - e.x) * k, y = e.y + (e.y2 - e.y) * k;
          ctx.beginPath(); ctx.moveTo(e.x + (e.x2 - e.x) * Math.max(0, k - 0.5), e.y + (e.y2 - e.y) * Math.max(0, k - 0.5)); ctx.lineTo(x, y); ctx.stroke();
          break;
        }
        case 'muzzle': {                                  // 銃：銃口の火
          ctx.fillStyle = '#fff2a0'; ctx.translate(e.x, e.y); ctx.scale(e.d, 1); star(20, 0, 34, 12, 6, e.t); ctx.fill();
          break;
        }
        case 'bowl': {                                    // 麺：巨大なラーメン丼から麺が伸びて、相手に巻きつき、すすり込む
          const k = Math.min(1, e.t / 8), fade = Math.min(1, (e.life - e.t) / 10), tx = e.ref ? e.ref.x : e.tx, ty = e.ref ? e.ref.y : e.ty;
          ctx.globalAlpha = fade;
          const ext = Math.max(0, Math.min(1, (e.t - 6) / 8)), wrap = Math.max(0, Math.min(1, (e.t - 14) / 10));
          ctx.lineCap = 'round';
          for (let s3 = 0; s3 < 3; s3++) {                                                    // 麺（3本）
            const sx = e.x + e.d * 40, sy = GROUND - 150 * k;
            ctx.strokeStyle = '#a07818'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(sx, sy);
            for (let j = 1; j <= 12; j++) { const q = j / 12 * ext, x = sx + (tx - sx) * q, y = sy + (ty - 100 - sy) * q - Math.sin(q * Math.PI) * 60 + Math.sin(j * 1.3 + e.t * 0.4 + s3 * 2) * 10; ctx.lineTo(x, y); }
            ctx.stroke(); ctx.strokeStyle = '#f2d36a'; ctx.lineWidth = 5; ctx.stroke();
          }
          if (wrap > 0) drawSnakeCoil(tx, ty - 20, ty - 130, 34, 3, 9, wrap, e.t, 0, ['#f2d36a', '#c9a030', '#fff0b0']);
          ctx.save(); ctx.translate(e.x, GROUND); ctx.scale(k * 1.6, k * 1.6); drawRamenBowl(e.t); ctx.restore();
          if (e.t % 3 === 0) spark(e.x + rand(-60, 60), GROUND - 150 * k, 'rgba(255,255,255,0.8)', 1, 1, { vy: -2, g: -0.02 });   // 湯気
          break;
        }
        // ---- 2026-11 に作り直した必殺技の絵 ----
        case 'tint': {                                    // 画面全体をうっすら染める（屁の黄緑・滅の暗さ）
          ctx.globalAlpha = (e.a || 0.35) * Math.min(1, e.t / 5) * Math.min(1, (e.life - e.t) / 15);
          ctx.fillStyle = `rgb(${e.color})`; ctx.fillRect(-W, -H, W * 3, H * 3);
          break;
        }
        case 'meadow': {                                  // 草：地面いっぱいに広がる草原（相手のまわりから左右へ）
          const grow = Math.min(1, e.t / 18), fade = Math.min(1, (e.life - e.t) / 16);
          ctx.globalAlpha = fade;
          const half = (W * 0.9) * grow;
          const gr = ctx.createLinearGradient(0, GROUND - 70, 0, GROUND + 30);
          gr.addColorStop(0, 'rgba(90,190,70,0)'); gr.addColorStop(0.45, 'rgba(90,190,70,0.55)'); gr.addColorStop(1, 'rgba(50,140,40,0.85)');
          ctx.fillStyle = gr; ctx.fillRect(e.x - half, GROUND - 70, half * 2, 100);
          ctx.strokeStyle = '#3f9a2f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
          for (let i = -40; i <= 40; i++) {                          // 草の葉がゆれる
            const x = e.x + i * 22; if (Math.abs(x - e.x) > half) continue;
            const h = 18 + ((i * 37) % 5 + 5) % 5 * 6, sw = Math.sin(e.t * 0.15 + i) * 6;
            ctx.beginPath(); ctx.moveTo(x, GROUND + 6); ctx.quadraticCurveTo(x + sw * 0.4, GROUND - h * 0.5, x + sw, GROUND - h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + 8, GROUND + 6); ctx.quadraticCurveTo(x + 8 - sw * 0.3, GROUND - h * 0.4, x + 6 - sw, GROUND - h * 0.75); ctx.stroke();
          }
          break;
        }
        case 'sprout': {                                  // 草：字が地面からにょきっと生えて、ゆれる
          const grow = Math.min(1, e.t / (e.pop ? 6 : 10)), s2 = 120 * (e.s || 1);
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const bounce = e.pop ? 1 + Math.max(0, 0.25 - e.t * 0.03) : 1;
          ctx.save(); ctx.beginPath(); ctx.rect(e.x - s2, -H, s2 * 2, e.y + H); ctx.clip();          // 地面より下は見えない
          ctx.translate(e.x, e.y + s2 * 0.75 * (1 - grow)); ctx.rotate(Math.sin(e.t * 0.2 + e.x) * 0.06); drawGrassArt(s2 / 100 * 1.8 * bounce, e.wshape, e.t);
          ctx.restore();
          if (e.t === 1) spark(e.x, GROUND - 4, '#5aa03a', 8, 4);
          break;
        }
        case 'lightdash': {                               // 光：画面を横切る光の線
          const k = 1 - p;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = k;
          const x0 = Math.min(e.x, e.x2), len = Math.abs(e.x2 - e.x);
          ctx.fillStyle = 'rgba(255,230,120,0.7)'; ctx.fillRect(x0, e.y - 14 * k - 3, len, 28 * k + 6);
          ctx.fillStyle = 'rgba(255,255,240,1)'; ctx.fillRect(x0, e.y - 3, len, 6);
          ctx.fillStyle = 'rgba(255,250,200,0.9)'; ctx.beginPath(); ctx.arc(e.x2, e.y, 26 * k + 6, 0, TAU); ctx.fill();
          break;
        }
        case 'fistline': {                                // 拳：残像の拳が相手へ飛んでいく
          const k = Math.min(1, e.t / 3), x = e.x + (e.x2 - e.x) * k, y = e.y + (e.y2 - e.y) * k;
          ctx.globalAlpha = Math.max(0, 1 - Math.max(0, e.t - 3) / 4);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
          for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x - sign(e.x2 - e.x) * 60, y + i * 12); ctx.lineTo(x - sign(e.x2 - e.x) * 14, y + i * 12); ctx.stroke(); }
          ctx.translate(x, y); ctx.scale(sign(e.x2 - e.x) || 1, 1); drawFistArt(1.9, e.side);
          break;
        }
        case 'bigfist': {                                 // 拳：最後の巨大な爆裂パンチ
          const k = Math.min(1, e.t / 6), x = e.x + (e.x2 - e.x) * k * k;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 6);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 6;
          for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x - e.d * 260, e.y + i * 30); ctx.lineTo(x - e.d * 90, e.y + i * 30); ctx.stroke(); }
          ctx.translate(x, e.y); ctx.scale(e.d, 1); drawFistArt(4.2, e.side);
          break;
        }
        case 'jab': {                                     // 拳：ふだんの追加ジャブ（小さな拳）
          const k = Math.min(1, e.t / 3);
          ctx.globalAlpha = Math.max(0, 1 - Math.max(0, e.t - 3) / 4);
          ctx.translate(e.x - e.d * 30 * (1 - k), e.y); ctx.scale(e.d, 1); drawFistArt(1.1, e.side);
          break;
        }
        case 'mirage': {                                  // 幻：元の場所の姿が、蜃気楼のようにゆらゆら揺れて消える
          for (let i = 0; i < 3; i++) {
            const off = Math.sin(e.t * 0.6 + i * 2.1) * (6 + p * 26);
            drawGhostOf(e.f, e.x + off, e.y - i * 2, e.d, 'saturate(0.3) brightness(1.3)', (0.38 - i * 0.1) * (1 - p));
          }
          ctx.globalAlpha = 0.5 * (1 - p); ctx.strokeStyle = 'rgba(200,180,255,0.8)'; ctx.lineWidth = 2;
          for (let j = 0; j < 6; j++) { const y0 = e.y - 20 - j * 26; ctx.beginPath(); for (let x = -50; x <= 50; x += 10) { const y = y0 + Math.sin(x * 0.12 + e.t * 0.5 + j) * 4; x > -50 ? ctx.lineTo(e.x + x, y) : ctx.moveTo(e.x + x, y); } ctx.stroke(); }
          break;
        }
        case 'shurikenfly': {                             // 忍：手裏剣が相手へ飛んでいく
          const k = Math.min(1, e.t / (e.big ? 9 : 6)), x = e.x + (e.x2 - e.x) * k, y = e.y + (e.y2 - e.y) * k;
          ctx.globalAlpha = k < 1 ? 1 : Math.max(0, 1 - (e.t - (e.big ? 9 : 6)) / 6);
          if (e.big) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 5; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x - sign(e.x2 - e.x) * 200, y + i * 40); ctx.lineTo(x - sign(e.x2 - e.x) * 70, y + i * 40); ctx.stroke(); } }
          ctx.translate(x, y); drawShuriken(e.big ? 110 : 32, e.t * 0.9);
          break;
        }
        case 'bees': {                                    // 蜂：左右から飛んできて、相手のまわりを飛び回る
          if (!e.bs) e.bs = Array.from({ length: e.n }, (_, i) => ({ side: i % 2 ? -1 : 1, y0: rand(-220, 40), at: 6 + (i % 7) * 2, r: rand(30, 75), a0: rand(0, TAU), sp: rand(0.25, 0.4) * (i % 3 ? 1 : -1), dy: rand(-60, 40) }));
          const cx = e.ref ? e.ref.x : e.x, cy = e.ref ? e.ref.y - 90 : e.y;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          for (const b of e.bs) {
            const a = b.a0 + e.t * b.sp, ox2 = cx + Math.cos(a) * b.r, oy2 = cy + b.dy * 0.6 + Math.sin(a) * b.r * 0.6;
            let x, y;
            if (e.t < b.at) { const k = e.t / b.at, sx = b.side > 0 ? cx + W * 0.8 : cx - W * 0.8; x = sx + (ox2 - sx) * k; y = cy + b.y0 + (oy2 - cy - b.y0) * k; }
            else { x = ox2; y = oy2; }
            drawBee(x, y, e.t < b.at ? -b.side : (Math.cos(a) * b.sp > 0 ? -1 : 1), e.t);
          }
          break;
        }
        case 'shadowclone': {                             // 影：黒い影分身が踏み込んで殴りかかる
          const k = Math.min(1, e.t / 9), x = e.x + (e.tx - e.x) * (1 - (1 - k) * (1 - k));
          if (!e.atk) e.atk = makeAttack(e.f, 'strong');
          e.atk.t = Math.min(e.atk.su + e.atk.act + e.atk.rec - 1, Math.max(0, e.t - 6) * 2);
          drawGhostOf(e.f, x, GROUND, e.d, 'brightness(0)', 0.88 * Math.min(1, (e.life - e.t) / 8) * Math.min(1, e.t / 3), e.atk);
          if (e.t < 9 && e.t % 2 === 0) particles.push({ x: x - e.d * 30, y: GROUND - rand(20, 140), vx: 0, vy: 0, g: 0, life: 8, color: 'rgba(30,30,40,0.7)', r: 2, streak: true });
          break;
        }
        case 'shadowsub': {                               // 影：身代わりになった影が、崩れて消える
          ctx.save(); ctx.beginPath(); ctx.rect(-W, e.y - 230 + p * 240, W * 3, H * 2); ctx.clip();
          drawGhostOf(e.f, e.x, e.y, e.d, 'brightness(0)', 0.85 * (1 - p * 0.5));
          ctx.restore();
          if (e.t % 2 === 0) spark(e.x + rand(-26, 26), e.y - 220 + p * 240, '#1a1a22', 2, 2, { vy: rand(-1, 1), g: 0.05 });
          break;
        }
        case 'phantomself': {                             // 幻：半透明の自分（宙に浮いている）
          const fl = Math.sin(e.t * 0.2 + e.x) * 6;
          drawGhostOf(e.f, e.x, e.y + fl, e.d, 'saturate(0.4) brightness(1.25)', 0.42 * Math.min(1, e.t / 6) * Math.min(1, (e.life - e.t) / 10));
          break;
        }
        case 'warp': {                                    // 幻：空間がゆらゆら歪む
          const k = Math.min(1, e.t / 10) * Math.min(1, (e.life - e.t) / 14);
          ctx.globalAlpha = k;
          ctx.fillStyle = 'rgba(120,80,180,0.16)'; ctx.fillRect(-W, -H, W * 3, H * 3);
          ctx.strokeStyle = 'rgba(190,150,255,0.5)'; ctx.lineWidth = 3;
          for (let j = 0; j < 16; j++) {
            const y0 = j * (GROUND + 60) / 16;
            ctx.beginPath();
            for (let x = -40; x <= W + 40; x += 20) { const y = y0 + Math.sin(x * 0.02 + e.t * 0.25 + j) * 10; x > -40 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
            ctx.stroke();
          }
          for (let r = 0; r < 4; r++) { const rr = ((e.t * 6 + r * 70) % 280) + 20; ctx.globalAlpha = k * (1 - rr / 300); ctx.beginPath(); ctx.ellipse(e.x, e.y, rr, rr * 0.6, 0, 0, TAU); ctx.stroke(); }
          break;
        }
        case 'phantomglyph': {                            // 幻：巨大な幻の字がふくらみ、相手を飲み込んで消える
          const sc = p < 0.55 ? Math.sin(p / 0.55 * Math.PI / 2) * 3.4 : 3.4 * (1 - (p - 0.55) / 0.45);
          ctx.globalAlpha = 0.62 * Math.min(1, e.t / 4);
          Texture.draw(ctx, e.w.ch, e.x, e.y, Math.max(4, Math.round(140 * sc)), weaponStyle(e.w), (p - 0.5) * 1.6);
          break;
        }
        case 'nightsky': {                                // 星：夜空（地面より上を紺色に、星がまたたく）
          const k = Math.min(1, e.t / 10) * Math.min(1, (e.life - e.t) / 18);
          ctx.globalAlpha = k * 0.85;
          const gr = ctx.createLinearGradient(0, -H, 0, GROUND);
          gr.addColorStop(0, '#0a0f3a'); gr.addColorStop(0.75, '#1c2a6a'); gr.addColorStop(1, 'rgba(40,60,130,0.4)');
          ctx.fillStyle = gr; ctx.fillRect(-W, -H, W * 3, GROUND + H);
          ctx.fillStyle = '#fff8d0';
          for (let i = 0; i < 60; i++) { const x = ((i * 137) % (W * 1.6)) - W * 0.3, y = ((i * 89) % (GROUND - 60)) - 40, tw = 0.5 + 0.5 * Math.sin(e.t * 0.3 + i); ctx.globalAlpha = k * tw; ctx.fillRect(x, y, 3, 3); }
          break;
        }
        case 'meteor': {                                  // 星：尾を引く流れ星が斜めに落ちてきて、着弾で爆発
          const T0 = e.final ? 12 : 9, k = Math.min(1, e.t / T0), s2 = e.s || 1;
          const sx = e.x - e.from * 520, sy = e.y - 640, x = sx + (e.x - sx) * k, y = sy + (e.y - sy) * k;
          if (e.t <= T0) {
            ctx.globalCompositeOperation = 'lighter';
            const tl = ctx.createLinearGradient(x, y, x - (e.x - sx) * 0.35, y - (e.y - sy) * 0.35);
            tl.addColorStop(0, 'rgba(255,240,170,0.95)'); tl.addColorStop(1, 'rgba(255,160,60,0)');
            ctx.strokeStyle = tl; ctx.lineWidth = 22 * s2; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (e.x - sx) * 0.35, y - (e.y - sy) * 0.35); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
            if (e.fire) { const g2 = ctx.createRadialGradient(x, y, 2, x, y, 30 * s2); g2.addColorStop(0, '#fff6c0'); g2.addColorStop(0.5, '#ff8a1f'); g2.addColorStop(1, 'rgba(230,50,20,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, 30 * s2, 0, TAU); ctx.fill(); }
            else { ctx.fillStyle = '#ffe35a'; ctx.strokeStyle = '#ff9a1f'; ctx.lineWidth = 3; star(x, y, 26 * s2, 11 * s2, 5, e.t * 0.3); ctx.fill(); ctx.stroke(); }
          }
          if (e.t >= T0 && !e.landed) {
            e.landed = true;
            addFx('explosion', e.x, e.y - 10, { life: e.final ? 46 : 22, r: e.final ? 220 : 70 * s2 });
            for (let i = 0; i < (e.final ? 30 : 8); i++) spark(e.x, e.y - 20, e.fire ? '#ff8a1f' : '#ffe35a', 1, e.final ? 10 : 6, e.fire ? {} : { ch: '★' });
            if (e.final) { shake = Math.max(shake, 20); sfx('boom'); }
          }
          break;
        }
        case 'serpent': {                                 // 蛇：地面から大蛇が現れ、巻きついて締め上げ、最後に噛みつく
          const cx = e.ref ? e.ref.x : e.x, base = e.ref ? e.ref.y : e.y, side = e.side;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const rise = Math.min(1, e.t / 10), coil = Math.max(0, Math.min(1, (e.t - 8) / 14));
          const tight = Math.max(0, Math.min(1, (e.t - 22) / 26)), rx = 58 - 18 * tight;
          // 地面から出てくる胴体
          const bx = cx + side * 130;
          ctx.strokeStyle = '#2f7a2c'; ctx.lineWidth = 40; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(bx, GROUND + 10); ctx.quadraticCurveTo(bx + side * 30, GROUND - 120 * rise, cx + rx, base - 14); ctx.stroke();
          ctx.strokeStyle = '#a8d870'; ctx.lineWidth = 12;
          ctx.beginPath(); ctx.moveTo(bx, GROUND + 10); ctx.quadraticCurveTo(bx + side * 30, GROUND - 120 * rise, cx + rx, base - 14); ctx.stroke();
          if (coil > 0) drawSnakeCoil(cx, base - 14, base - 160, rx, 3.4, 32, coil, e.t, 0);
          // 頭：相手の上から見下ろし、最後に噛みつく
          const bite = Math.max(0, Math.min(1, (e.t - 46) / 6)), hx = cx - side * 20, hy = base - 230 + bite * 120 + Math.sin(e.t * 0.15) * 6;
          if (coil >= 1 || e.t > 20) {
            ctx.strokeStyle = '#2f7a2c'; ctx.lineWidth = 36;
            ctx.beginPath(); ctx.moveTo(cx - rx * 0.6, base - 160); ctx.quadraticCurveTo(cx + side * 60, base - 210, hx, hy); ctx.stroke();
            drawSnakeHead(hx, hy, -side, 3.2, bite > 0, e.t);
          }
          break;
        }
        case 'fireball': {                                // 球：炎をまとった剛速球
          const k = Math.min(1, e.t / (e.life - 1)), x = e.x + (e.tx - e.x) * k, y = e.y + (e.ty - e.y) * k, d = sign(e.tx - e.x) || 1;
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 6; i++) {
            const tx = x - d * i * 26, r = 34 - i * 4;
            const gr = ctx.createRadialGradient(tx, y, 2, tx, y, r);
            gr.addColorStop(0, 'rgba(255,240,160,0.9)'); gr.addColorStop(0.5, 'rgba(255,120,30,0.6)'); gr.addColorStop(1, 'rgba(255,40,0,0)');
            ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(tx, y + Math.sin(e.t + i) * 3, r, 0, TAU); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          Texture.draw(ctx, e.w.ch, x, y, 92, weaponStyle(e.w), e.t * 0.8 * d);           // 「球」の字そのものが燃えて飛ぶ
          if (e.t % 1 === 0) spark(x, y, '#ffb030', 3, 3, { g: -0.05 });
          break;
        }
        case 'clone': {                                   // 必殺・幻：字の分身が飛んでくる
          const k = Math.min(1, e.t / 10), r = 300 * (1 - k * k);
          ctx.globalAlpha = e.t < 10 ? 0.95 : Math.max(0, 1 - (e.t - 10) / 8);
          const size = e.final ? 200 : 120;
          for (let g = 3; g >= 0; g--) {                   // 残像
            const rr = r + g * 40 * (1 - k);
            ctx.save(); ctx.globalAlpha *= g ? 0.25 : 1;
            Texture.draw(ctx, e.w.ch, e.x + Math.cos(e.a) * rr, e.y + Math.sin(e.a) * rr * 0.6, size, weaponStyle(e.w), e.a * 0.3);
            ctx.restore();
          }
          break;
        }
        case 'stampede': {                                // 必殺・牛：字の群れが駆け抜ける
          const front = e.x + e.dir * (e.t - 16) * 18;      // 16コマ目に先頭が相手に届く
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 8);
          for (let i = 5; i >= 0; i--) {
            const x = front - e.dir * i * 80, hop = Math.abs(Math.sin(e.t * 0.5 + i * 1.3));
            ctx.fillStyle = 'rgba(201,163,107,0.45)';
            ctx.beginPath(); ctx.ellipse(x - e.dir * 50, GROUND - 6, 60, 16, 0, 0, TAU); ctx.fill();
            Texture.draw(ctx, e.w.ch, x, GROUND - 70 - hop * 28, 110 + (i % 2) * 24, weaponStyle(e.w), Math.sin(e.t * 0.5 + i) * 0.15 * e.dir);
          }
          break;
        }
        case 'blackhole': {                               // 必殺・重：重力の玉
          let R = 25 + 55 * Math.min(1, e.t / 12);
          if (p > 0.8) R *= Math.max(0, (1 - p) / 0.2);
          ctx.globalAlpha = 1;
          for (let i = 0; i < 18; i++) {                   // 吸い込まれる粒
            const q = ((i * 37 + e.t * 7) % 220) / 220, rr = R + 200 * (1 - q), a = i * 1.7 + q * 3;
            ctx.fillStyle = `rgba(200,160,255,${q})`; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr * 0.6, 3 + q * 2, 0, TAU); ctx.fill();
          }
          ctx.strokeStyle = 'rgba(170,90,255,0.85)'; ctx.lineWidth = 8;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, R * 2.1, R * 0.45, -0.2, 0, TAU); ctx.stroke();
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, R);
          g.addColorStop(0, '#000000'); g.addColorStop(0.75, '#12001f'); g.addColorStop(1, '#7a3ad0');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(220,190,255,0.9)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, R * 2.1, R * 0.45, -0.2, Math.PI, TAU); ctx.stroke();
          break;
        }
        case 'bigdrop': {                                 // 必殺・ふつうの字：巨大な字が空から落ちる
          const fall = Math.min(1, e.t / 14), size = 300;
          const y = (e.y - 120) - (1 - fall * fall) * 700;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          if (e.t < 14) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(e.x, GROUND, 140 * fall, 20 * fall, 0, 0, TAU); ctx.fill(); }
          if (e.divine) {                                 // 神：後光をまとって降りてくる
            ctx.save();
            const gr = ctx.createRadialGradient(e.x, y, 30, e.x, y, 260);
            gr.addColorStop(0, 'rgba(255,250,210,0.95)'); gr.addColorStop(0.5, 'rgba(255,220,110,0.45)'); gr.addColorStop(1, 'rgba(255,210,90,0)');
            ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(e.x, y, 260, 0, TAU); ctx.fill();
            ctx.strokeStyle = 'rgba(255,230,120,0.85)'; ctx.lineWidth = 6;
            for (let i = 0; i < 16; i++) { const a = i * TAU / 16 + e.t * 0.03; ctx.beginPath(); ctx.moveTo(e.x + Math.cos(a) * 150, y + Math.sin(a) * 150); ctx.lineTo(e.x + Math.cos(a) * 240, y + Math.sin(a) * 240); ctx.stroke(); }
            ctx.restore();
          }
          Texture.draw(ctx, e.w.ch, e.x, y, size, e.divine ? 'gold' : weaponStyle(e.w), 0, e.t >= 14 ? 1 + Math.max(0, 0.15 - (e.t - 14) * 0.02) : 1);
          if (e.t >= 14 && !e.landed) { e.landed = true; addFx('ring', e.x, GROUND - 10, { color: '#ffffff', life: 20, big: true }); spark(e.x, GROUND - 10, '#c9a36b', 40, 12); }
          break;
        }
        case 'manji': {                                   // 卍の必殺：回りながら弧を描いて飛ぶ卍
          const k = Math.min(1, e.t / e.life), x = e.x + (e.tx - e.x) * k, y = e.y + (e.ty - e.y) * k - Math.sin(k * Math.PI) * e.arc;
          ctx.globalAlpha = 1;
          Texture.draw(ctx, '卍', x, y, Math.round(e.size), weaponStyle(e.w), e.t * (e.spin || 0.5));
          break;
        }
        case 'godrays': {                                 // 神の必殺：天が開いて光が降り注ぐ
          ctx.globalAlpha = Math.min(1, e.t / 12) * Math.min(1, (e.life - e.t) / 20);
          const gr = ctx.createRadialGradient(e.x, -60, 20, e.x, -60, 460);
          gr.addColorStop(0, 'rgba(255,255,235,0.85)'); gr.addColorStop(0.4, 'rgba(255,230,140,0.45)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
          ctx.fillStyle = gr; ctx.fillRect(e.x - 520, -520, 1040, 980);
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 9; i++) {
            const sw = Math.sin(e.t * 0.05 + i) * 30, x0 = e.x + (i - 4) * 18, x1 = e.x + (i - 4) * 90 + sw;
            ctx.fillStyle = `rgba(255,236,160,${0.14 + 0.08 * Math.sin(e.t * 0.2 + i * 1.7)})`;
            ctx.beginPath(); ctx.moveTo(x0 - 6, -120); ctx.lineTo(x0 + 6, -120); ctx.lineTo(x1 + 44, GROUND + 20); ctx.lineTo(x1 - 44, GROUND + 20); ctx.fill();
          }
          break;
        }
        case 'chainwrap': {                               // 鎖の必殺：体に何重にも巻きついて、だんだん締まる
          const cx = e.ref ? e.ref.x : e.x, base = e.ref ? e.ref.y : e.y;
          const turns = Math.min(5, Math.floor(e.t / 3) + 1), tight = Math.min(1, Math.max(0, (e.t - 16) / 50));
          const rx = 46 - 18 * tight, jit = tight > 0 ? rand(-2, 2) * tight : 0;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const link = (x, y, ang, back) => {
            ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
            ctx.strokeStyle = back ? '#222' : '#3a3a3a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, 0, 10, 5.5, 0, 0, TAU); ctx.stroke();
            ctx.strokeStyle = back ? '#888' : '#e2e2e2'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 0, 10, 5.5, 0, 0, TAU); ctx.stroke();
            ctx.restore();
          };
          for (const back of [true, false]) {             // 後ろ側の鎖を先に（体の陰になる側は暗く）
            for (let r = 0; r < turns; r++) {
              const cy = base - 34 - r * 26;
              for (let i = 0; i < 14; i++) {
                const a = i / 14 * TAU + r * 0.45, isBack = Math.sin(a) < 0;
                if (isBack !== back) continue;
                link(cx + Math.cos(a) * rx + jit, cy + Math.sin(a) * 9 - Math.cos(a) * 4, i % 2 ? Math.PI / 2 + 0.25 : 0.25, back);
              }
            }
          }
          break;
        }
        case 'bigheart': {                                // 愛の必殺：巨大なハートが空から落ちる（着地でむにっとつぶれる）
          const fall = Math.min(1, e.t / 14), s = 320, h = s / 2;
          const y = (e.y - h * 0.9) - (1 - fall * fall) * 720;
          const k = e.t >= 14 ? Math.max(0, 1 - (e.t - 14) / 10) : 0;          // つぶれ具合
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          if (e.t < 14) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(e.x, GROUND, 150 * fall, 22 * fall, 0, 0, TAU); ctx.fill(); }
          ctx.save();
          ctx.translate(e.x, y + h * 0.9); ctx.scale(1 + 0.18 * k, 1 - 0.2 * k); ctx.translate(0, -h * 0.9);   // 下の先を支点につぶす
          const heart = () => {
            ctx.beginPath(); ctx.moveTo(0, h * 0.9);
            ctx.bezierCurveTo(-h * 1.35, h * 0.05, -h * 0.95, -h * 1.05, 0, -h * 0.45);
            ctx.bezierCurveTo(h * 0.95, -h * 1.05, h * 1.35, h * 0.05, 0, h * 0.9); ctx.closePath();
          };
          heart(); ctx.lineJoin = 'round';
          ctx.lineWidth = 22; ctx.strokeStyle = '#4a0820'; ctx.stroke();       // 太い縁取り（字と同じ雰囲気に）
          ctx.lineWidth = 10; ctx.strokeStyle = '#ffd6e6'; ctx.stroke();
          const gr = ctx.createLinearGradient(0, -h, 0, h);
          gr.addColorStop(0, '#ff9cc2'); gr.addColorStop(0.55, '#ff3d7f'); gr.addColorStop(1, '#c2104f');
          ctx.fillStyle = gr; heart(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';                            // つやの光
          ctx.beginPath(); ctx.ellipse(-h * 0.5, -h * 0.5, h * 0.22, h * 0.12, -0.6, 0, TAU); ctx.fill();
          ctx.restore();
          if (e.t >= 14 && !e.landed) { e.landed = true; addFx('ring', e.x, GROUND - 10, { color: '#ff8fb8', life: 20, big: true }); spark(e.x, GROUND - 10, '#ff5b9a', 40, 12); shake = Math.max(shake, 18); }
          break;
        }
        // ---- 入れ替えで追加した字の必殺技 ----
        case 'fallobj': {                                 // 母・筋・鮨・税：空から降ってきて地面に積もる小物
          const k = Math.min(1, e.t / 14), y = e.y - (1 - k * k) * 640;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 8);
          ctx.translate(e.x, y - 14); ctx.rotate((e.rot || 0) + (k < 1 ? e.t * 0.25 : 0));
          drawObj(e.obj, e.neta, e.obj === 'rock' ? e.rs : 1.4, e.seed);
          if (e.t === 14) spark(e.x, e.y, '#ffffff', 3, 2);
          break;
        }
        case 'bigobj': {                                  // 特大のネギ・バーベルが落ちてくる
          const k = Math.min(1, e.t / 12), y = e.y - (1 - k * k) * 700;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          if (e.t < 12) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(e.x, GROUND, 130 * k, 20 * k, 0, 0, TAU); ctx.fill(); }
          ctx.translate(e.x, y); ctx.rotate(e.rot || 0);
          drawObj(e.obj, null, e.s, e.seed);
          if (e.t >= 12 && !e.landed) { e.landed = true; addFx('ring', e.x, GROUND - 10, { color: '#ffffff', life: 20, big: true }); spark(e.x, GROUND - 10, '#c9a36b', 34, 11); shake = Math.max(shake, 18); }
          break;
        }
        case 'sandpit': {                                 // 砂：すり鉢状の蟻地獄（砂の渦が内へ流れ込む）
          const cx = e.ref ? e.ref.x : e.x, grow = Math.min(1, e.t / 10), fade = Math.min(1, (e.life - e.t) / 14);
          const rx = 150 * grow, ry = 34 * grow;
          ctx.globalAlpha = fade;
          const gr = ctx.createRadialGradient(cx, GROUND, 4, cx, GROUND, rx);
          gr.addColorStop(0, '#5a4320'); gr.addColorStop(0.35, '#9a7a44'); gr.addColorStop(0.8, '#cfb27a'); gr.addColorStop(1, 'rgba(220,196,140,0)');
          ctx.save(); ctx.translate(cx, GROUND); ctx.scale(1, ry / Math.max(1, rx));
          ctx.fillStyle = gr; ctx.translate(-cx, -GROUND); ctx.beginPath(); ctx.arc(cx, GROUND, rx, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(90,64,28,0.55)'; ctx.lineWidth = 3;                // 内へ回りこむ砂の筋
          for (let k = 0; k < 5; k++) { const a0 = e.t * 0.12 + k * TAU / 5; ctx.beginPath(); for (let j = 0; j <= 14; j++) { const r = rx * (1 - j / 15), a = a0 + j * 0.28; const px = cx + Math.cos(a) * r, py = GROUND + Math.sin(a) * r; j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
          ctx.restore();
          if (e.t % 3 === 0 && e.t < e.life - 14) spark(cx + rand(-rx, rx) * 0.9, GROUND - rand(0, 6), '#c9a36b', 1, 1, { vx: 0, g: 0.02 });
          break;
        }
        case 'flower': {                                  // 花：地面から茎がのびて、花がひらく
          const grow = Math.min(1, e.t / 8), open = Math.max(0, Math.min(1, (e.t - 6) / 8)), s = e.s || 1;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 10);
          const h = 46 * s * grow, top = e.y - h;
          ctx.strokeStyle = '#3c8a3a'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.quadraticCurveTo(e.x + 6 * s, e.y - h * 0.5, e.x, top); ctx.stroke();
          ctx.fillStyle = '#4cae48'; ctx.beginPath(); ctx.ellipse(e.x + 8 * s, e.y - h * 0.4, 9 * s * grow, 4 * s * grow, -0.5, 0, TAU); ctx.fill();
          if (open > 0) {
            const cols = [['#ff7eb6', '#ffd1e6'], ['#ffd84d', '#fff3b0'], ['#ffffff', '#ffe3ef'], ['#ff5a5a', '#ffc2c2']][e.hue || 0];
            const pr = 13 * s * open;
            ctx.save(); ctx.translate(e.x, top); ctx.rotate(e.t * 0.02);
            for (let k = 0; k < 6; k++) { ctx.rotate(TAU / 6); ctx.fillStyle = cols[0]; ctx.beginPath(); ctx.ellipse(0, -pr * 0.75, pr * 0.5, pr * 0.8, 0, 0, TAU); ctx.fill(); ctx.fillStyle = cols[1]; ctx.beginPath(); ctx.ellipse(0, -pr * 0.7, pr * 0.22, pr * 0.45, 0, 0, TAU); ctx.fill(); }
            ctx.fillStyle = '#f2a600'; ctx.beginPath(); ctx.arc(0, 0, pr * 0.38, 0, TAU); ctx.fill();
            ctx.restore();
          }
          break;
        }
        case 'bigflower': {                               // 花：相手の後ろで巨大な花がパッと開く
          const open = Math.min(1, e.t / 10), pop = open < 1 ? open : 1 + Math.sin(Math.min(1, (e.t - 10) / 6) * Math.PI) * 0.08;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12);
          const cy = e.y - 130, R = 170 * pop;
          ctx.strokeStyle = '#3c8a3a'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x, cy); ctx.stroke();
          ctx.save(); ctx.translate(e.x, cy); ctx.rotate(e.t * 0.015);
          ctx.strokeStyle = '#b0124f'; ctx.lineWidth = 4;
          for (const [n, rr, c1, c2] of [[10, 1, '#e8105f', '#ff7eb0'], [8, 0.62, '#ff4f92', '#ffc4dc']]) {
            for (let k = 0; k < n; k++) { ctx.rotate(TAU / n); const pr = R * rr * open; const g2 = ctx.createLinearGradient(0, 0, 0, -pr); g2.addColorStop(0, c2); g2.addColorStop(1, c1); ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(0, -pr * 0.55, pr * 0.28, pr * 0.55, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
          }
          ctx.fillStyle = '#ffcc33'; ctx.beginPath(); ctx.arc(0, 0, R * 0.18 * open, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(200,120,0,0.6)'; for (let k = 0; k < 14; k++) { const a = k * TAU / 14; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1, 3, 0, TAU); ctx.fill(); }
          ctx.restore();
          if (e.t === 10) { addFx('ring', e.x, cy, { color: '#ffb3d1', life: 20, big: true }); }
          break;
        }
        case 'nigiri': {                                  // 鮨：相手をシャリに乗せ、上からネタをかぶせて巨大な握り寿司に
          const cx = e.ref ? e.ref.x : e.x, base = e.ref ? e.ref.y : e.y;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12);
          const rk = Math.min(1, e.t / 8);                  // シャリがせり上がる
          ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.roundRect(cx - 110, base - 64 * rk, 220, 64 * rk + 6, 30); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ece6d6'; for (let i = 0; i < 26; i++) { const gx = cx - 96 + ((i * 37) % 192), gy = base - 8 - ((i * 23) % 50) * rk; ctx.beginPath(); ctx.ellipse(gx, gy, 5, 3, i, 0, TAU); ctx.fill(); }
          if (e.t >= 10) {                                  // ネタが上から落ちてきて体にかぶさる
            const nk = Math.min(1, (e.t - 10) / 8), ny = base - 112 - (1 - nk * nk) * 520;   // 頭だけ出るように
            ctx.save(); ctx.translate(cx, ny);
            ctx.fillStyle = '#ff8a50'; ctx.strokeStyle = '#c85a2a'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(-130, 40); ctx.quadraticCurveTo(-130, -6, -60, -10); ctx.lineTo(60, -10); ctx.quadraticCurveTo(130, -6, 130, 40);
            ctx.quadraticCurveTo(130, 96, 112, 96); ctx.lineTo(-112, 96); ctx.quadraticCurveTo(-130, 96, -130, 40); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#ffd6bd'; ctx.lineWidth = 7; for (const x of [-80, -30, 20, 70]) { ctx.beginPath(); ctx.moveTo(x, -6); ctx.quadraticCurveTo(x + 20, 40, x + 30, 92); ctx.stroke(); }
            ctx.restore();
            if (nk >= 1 && !e.landed) { e.landed = true; shake = Math.max(shake, 14); spark(cx, base - 100, '#ffffff', 20, 6); }
          }
          break;
        }
        case 'hanko': {                                   // 税：巨大な「増税」の判子が押される
          const k = Math.min(1, e.t / 8), sc = 1 + (1 - k) * 1.6;
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12) * (0.4 + 0.6 * k);
          ctx.translate(e.x, e.y); ctx.rotate(-0.12); ctx.scale(sc, sc);
          ctx.strokeStyle = '#d0201a'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, 92, 0, TAU); ctx.stroke();
          ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 78, 0, TAU); ctx.stroke();
          ctx.fillStyle = '#d0201a'; ctx.font = `900 ${EN ? 40 : 66}px ${Weapon.FONT_FAMILY || 'serif'}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(L('増税', 'TAX'), 0, 4);
          if (e.t === 8) { shake = Math.max(shake, 20); addFx('ring', e.x, e.y, { color: '#d0201a', life: 18, big: true }); }
          break;
        }
        case 'skycrack': {                                // 罰：空が割れる
          const k = Math.min(1, e.t / 10);
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 14);
          ctx.strokeStyle = '#fffbe0'; ctx.shadowColor = '#ffe680'; ctx.shadowBlur = 24; ctx.lineWidth = 5; ctx.lineJoin = 'miter';
          let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
          for (let b = 0; b < 5; b++) {
            ctx.beginPath(); let x = e.x + (b - 2) * 40, y = 0; ctx.moveTo(x, y);
            const len = (90 + rnd() * 90) * k;
            while (y < len) { y += 14 + rnd() * 16; x += (rnd() - 0.5) * 50; ctx.lineTo(x, Math.min(y, len)); }
            ctx.stroke();
          }
          break;
        }
        case 'wisp': {                                    // 魂：人魂が渦を巻きながら相手へ飛んでいく
          const k = Math.min(1, e.t / e.life), r = (1 - k) * 110, a = e.a0 + k * 9;
          const x = e.x + (e.tx - e.x) * k + Math.cos(a) * r * 0.6, y = e.y + (e.ty - e.y) * k + Math.sin(a) * r * 0.4;
          ctx.globalAlpha = 1; drawWisp(x, y, 11, e.t, 1);
          break;
        }
        case 'clock5': {                                  // 乙：17:00を指す時計
          const sc = Math.min(1, e.t / 8);
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12);
          ctx.translate(e.x, e.y); ctx.scale(sc, sc);
          ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = '#334'; ctx.lineWidth = 7;
          ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.lineWidth = 3; for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ctx.beginPath(); ctx.moveTo(Math.sin(a) * 58, -Math.cos(a) * 58); ctx.lineTo(Math.sin(a) * 66, -Math.cos(a) * 66); ctx.stroke(); }
          const ha = 5 * TAU / 12 * Math.min(1, e.t / 10);  // 時針が5へ回る
          ctx.lineCap = 'round'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(ha) * 36, -Math.cos(ha) * 36); ctx.stroke();
          ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -54); ctx.stroke();
          ctx.fillStyle = '#c0392b'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('17:00', 0, 32);
          break;
        }
        case 'reaper': {                                  // 鎌：相手の背後に死神の影が現れ、巨大な鎌を振り抜く
          const d = e.dir, cx = Math.max(140, Math.min(W - 140, e.x + d * 50)), top = e.y - 300;
          ctx.globalAlpha = Math.min(1, e.t / 10) * Math.min(1, (e.life - e.t) / 12) * 0.92;
          ctx.fillStyle = '#140818';
          ctx.beginPath(); ctx.moveTo(cx, top); ctx.bezierCurveTo(cx - 90, top + 30, cx - 110, e.y - 40, cx - 120, e.y); ctx.lineTo(cx + 120, e.y); ctx.bezierCurveTo(cx + 110, e.y - 40, cx + 90, top + 30, cx, top); ctx.fill();
          ctx.fillStyle = '#ff2a4a'; ctx.beginPath(); ctx.arc(cx - 18, top + 70, 6, 0, TAU); ctx.arc(cx + 18, top + 70, 6, 0, TAU); ctx.fill();
          const sw = e.t < 8 ? -1.6 : -1.6 + Math.min(1, (e.t - 8) / 6) * 3.0;   // 鎌を振りかぶって振り抜く
          ctx.save(); ctx.translate(cx, top + 120); ctx.rotate(sw * -d); ctx.scale(-d, 1);
          ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(0, 120); ctx.lineTo(0, -150); ctx.stroke();
          ctx.fillStyle = '#c8ccd6'; ctx.strokeStyle = '#1a1a22'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(0, -150); ctx.quadraticCurveTo(140, -170, 220, -60); ctx.quadraticCurveTo(130, -120, 0, -118); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'parade': {                                  // 霊：お化けの行列が通り抜ける
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 12);
          for (let i = 0; i < 9; i++) {
            const x = e.x - e.dir * 420 + e.dir * (e.t * 12 - i * 70), y = e.y - 90 - (i % 3) * 40 + Math.sin(e.t * 0.2 + i) * 10;
            if (Math.abs(x - e.x) > 520) continue;
            drawGhost(x, y, 1.3 + (i % 2) * 0.4, e.t + i * 5, e.dir);
          }
          break;
        }
        case 'kickball': {                                // 蹴：足もと（〜8）→ 蹴り上げて上がって落ちる（8〜24）→ ボレーで燃えるシュート（24〜）
          const up = 24;
          let x, y;
          if (e.t < 8) { x = e.x; y = e.y - 32; }
          else if (e.t < up) { const k = (e.t - 8) / 16; x = e.x + e.dir * 6 * Math.sin(k * Math.PI); y = e.y - 30 - Math.sin(k * Math.PI) * 170 - k * 30; }
          else { const k = Math.min(1, (e.t - up) / 7); x = e.x + (e.tx - e.x) * k; y = e.y - 60 + (e.ty - (e.y - 60)) * k; }
          ctx.globalAlpha = Math.min(1, (e.life - e.t) / 6);
          if (e.t >= up) { const gr = ctx.createRadialGradient(x, y, 6, x, y, 90); gr.addColorStop(0, 'rgba(255,240,160,0.9)'); gr.addColorStop(0.5, 'rgba(255,110,20,0.6)'); gr.addColorStop(1, 'rgba(255,50,0,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 90, 0, TAU); ctx.fill(); spark(x, y, '#ff8a1f', 2, 3, { g: -0.05 }); }
          Texture.draw(ctx, e.w.ch, x, y, e.t < up ? 64 : 64 + Math.min(1, (e.t - up) / 4) * 40, weaponStyle(e.w), e.t * 0.6 * e.dir);   // 足もとでは小さめ（蹴る脚が隠れないように）、シュートで大きく
          break;
        }
        case 'ring':
          ctx.strokeStyle = e.color; ctx.lineWidth = 7 * (1 - p) + 1;
          ctx.beginPath(); ctx.arc(e.x, e.y, 12 + p * 55, 0, TAU); ctx.stroke(); break;
        case 'ripple':
          ctx.strokeStyle = e.color; ctx.lineWidth = 4;
          for (const k of [1, 0.6]) { ctx.beginPath(); ctx.arc(e.x, e.y, 8 + p * 70 * k, 0, TAU); ctx.stroke(); }
          break;
        case 'slash': {                                   // 斬撃の線
          const w = (e.wide || 1) * 55, dir = e.dir;
          ctx.strokeStyle = e.color; ctx.lineCap = 'round';
          ctx.shadowColor = e.color; ctx.shadowBlur = 12;
          ctx.lineWidth = 9 * (1 - p) + 1;
          ctx.beginPath();
          if (e.flat) { ctx.moveTo(e.x - w * dir, e.y + 6); ctx.quadraticCurveTo(e.x, e.y - 14, e.x + w * dir, e.y + 6); }
          else { ctx.moveTo(e.x - w * 0.6 * dir, e.y - w * 0.7); ctx.lineTo(e.x + w * 0.6 * dir, e.y + w * 0.7); }
          ctx.stroke(); break;
        }
        case 'thrust':                                    // 突きの線
          ctx.strokeStyle = e.color || '#ffffff'; ctx.lineWidth = (e.thin ? 3 : 8) * (1 - p) + 1; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(e.x - e.dir * 70, e.y); ctx.lineTo(e.x + e.dir * (20 + p * 30), e.y); ctx.stroke(); break;
        case 'bolt': {                                    // 稲妻（上から落ちる）
          ctx.strokeStyle = e.dark ? '#2a0a3a' : '#fff59a'; ctx.shadowColor = e.dark ? '#b050ff' : '#ffe14d'; ctx.shadowBlur = 16; ctx.lineWidth = 6; ctx.lineJoin = 'miter';
          for (const off of [0, 1]) {
            ctx.beginPath(); let x = e.x + (off ? 18 : -10), y = 0;
            ctx.moveTo(x, y);
            while (y < e.y + 40) { y += 22 + Math.random() * 18; x += (Math.random() - 0.5) * 40; ctx.lineTo(x, Math.min(y, e.y + 40)); }
            ctx.stroke(); ctx.lineWidth = 3;
          }
          if (e.t < 3 && !e.dark) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff8c0'; ctx.fillRect(0, 0, W, H); }
          break;
        }
        case 'weight': {                                  // 重：分銅が落ちてくる
          const fall = Math.min(1, e.t / 8), y = e.y - 160 * (1 - fall);
          ctx.fillStyle = '#444'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(e.x - 28, y - 40); ctx.lineTo(e.x + 28, y - 40); ctx.lineTo(e.x + 42, y + 10); ctx.lineTo(e.x - 42, y + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(e.x, y - 48, 9, 0, TAU); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('重', e.x, y - 14);
          if (e.t === 8) { shake = Math.max(shake, 12); burst(e.x, y + 10, '#999', 10, 5); }
          break;
        }
        case 'pillar': {                                  // 光の柱
          const gr = ctx.createLinearGradient(e.x - 40, 0, e.x + 40, 0);
          gr.addColorStop(0, `rgba(${e.color},0)`); gr.addColorStop(0.5, `rgba(${e.color},0.75)`); gr.addColorStop(1, `rgba(${e.color},0)`);
          ctx.fillStyle = gr; ctx.fillRect(e.x - 40, 0, 80, e.y + 4); break;
        }
        case 'stamp': {                                   // 笑：顔にハンコ
          const d = e.ref, s = 1 + Math.max(0, 0.6 - e.t * 0.1);
          ctx.translate(d.x, d.y - 115); ctx.scale(s, s); ctx.rotate(-0.2);
          ctx.strokeStyle = '#d33'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.stroke();
          ctx.fillStyle = '#d33'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.ch, 0, 2);
          break;
        }
        case 'clock': {                                   // 時：時計の文字盤
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = '#446'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(e.x, e.y, 34, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x, e.y - 24); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + 16, e.y + 6); ctx.stroke();
          break;
        }
        case 'anger': {                                   // 怒：怒りマーク
          ctx.strokeStyle = '#e02020'; ctx.lineWidth = 5; ctx.lineCap = 'round';
          const s = 12 + Math.sin(e.t * 0.6) * 2;
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.beginPath(); ctx.moveTo(e.x + sx * 4, e.y + sy * s); ctx.quadraticCurveTo(e.x + sx * 4, e.y + sy * 4, e.x + sx * s, e.y + sy * 4); ctx.stroke();
          }
          break;
        }
        case 'omikuji': {                                 // 運：おみくじの紙（文字の後ろ）
          const y = e.y - e.t * 0.8;
          ctx.fillStyle = '#fffdf3'; ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 3;
          ctx.fillRect(e.x - 40, y - 26, 80, 44); ctx.strokeRect(e.x - 40, y - 26, 80, 44);
          break;
        }
        case 'tornado': {                                 // 嵐：地面から相手まで伸びる竜巻
          const d = e.ref, topY = Math.min(d.y - 60, GROUND - 120), fade = Math.min(1, (e.life - e.t) / 15);
          const n = 14;
          ctx.save(); ctx.globalAlpha *= 0.75 * fade; ctx.lineWidth = 4;
          for (let i = 0; i < n; i++) {
            const k = i / (n - 1), y = GROUND - (GROUND - topY) * k;
            const rx = 14 + k * 70, sway = Math.sin(e.t * 0.3 + k * 5) * 10 * k;
            ctx.strokeStyle = i % 2 ? '#8aa4bc' : '#c9d6e2';
            ctx.beginPath(); ctx.ellipse(e.x + sway, y, rx, rx * 0.22, 0, (e.t * 0.5 + i) % TAU, (e.t * 0.5 + i) % TAU + 4.4); ctx.stroke();
          }
          ctx.restore(); break;
        }
        case 'swirl': {                                   // 風：渦
          ctx.strokeStyle = '#5ab08a'; ctx.lineWidth = 4;
          ctx.beginPath();
          for (let i = 0; i < 40; i++) { const a = i * 0.45 + e.t * 0.4, r = i * 1.6; ctx.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * 0.7); }
          ctx.stroke(); break;
        }
        case 'chain': case 'noodle': {                    // 鎖・麺：殴った側から相手までつながる
          const a = e.a.weaponGeom(), b = e.b;
          ctx.strokeStyle = e.type === 'chain' ? '#888' : '#f2d27a'; ctx.lineWidth = e.type === 'chain' ? 4 : 6;
          if (e.type === 'chain') {
            const n = 9;
            for (let i = 0; i < n; i++) {
              const k = (i + 0.5) / n; ctx.beginPath();
              ctx.ellipse(a.hx + (b.x - a.hx) * k, a.hy + (b.y - 90 - a.hy) * k, 8, 5, Math.atan2(b.y - 90 - a.hy, b.x - a.hx) + (i % 2 ? Math.PI / 2 : 0) * 0, 0, TAU); ctx.stroke();
            }
          } else {
            ctx.beginPath(); ctx.moveTo(a.hx, a.hy);
            for (let i = 1; i <= 16; i++) { const k = i / 16; ctx.lineTo(a.hx + (b.x - a.hx) * k, a.hy + (b.y - 90 - a.hy) * k + Math.sin(k * 20 + e.t) * 8); }
            ctx.stroke();
          }
          break;
        }
        case 'teeth': {                                   // 歯形
          ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#c0392b'; ctx.lineWidth = 2;
          for (const row of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(e.x - 30, e.y + row * 10);
            for (let i = 0; i < 6; i++) ctx.lineTo(e.x - 30 + i * 10 + 5, e.y + row * (i % 2 ? 10 : 22)), ctx.lineTo(e.x - 30 + (i + 1) * 10, e.y + row * 10);
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
          break;
        }
        case 'claw':                                      // 爪あと3本
          ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
          for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(e.x - 20 + i * 14, e.y - 30); ctx.lineTo(e.x + 10 + i * 14, e.y + 30); ctx.stroke(); }
          break;
        case 'circle': {                                  // 魔：魔法陣
          ctx.translate(e.x, e.y - 4); ctx.scale(1, 0.32); ctx.rotate(e.t * 0.12);
          ctx.strokeStyle = e.color; ctx.lineWidth = 4; ctx.shadowColor = e.color; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 52, 0, TAU); ctx.stroke();
          ctx.beginPath(); for (let i = 0; i <= 5; i++) { const a = i * 4 * Math.PI / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * 52, Math.sin(a) * 52); } ctx.stroke();
          break;
        }
        case 'rings':                                     // 叫：声の波紋
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
          for (const k of [1, 0.7, 0.4]) { ctx.beginPath(); ctx.arc(e.x, e.y, 20 + p * 220 * k, -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(e.x, e.y, 20 + p * 220 * k, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke(); }
          break;
        case 'crack': {                                   // 鏡：ひび
          ctx.strokeStyle = '#bfeaff'; ctx.lineWidth = 2.5;
          for (let i = 0; i < 7; i++) { const a = i * 0.9 + (e.seed || 0); ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30); ctx.lineTo(e.x + Math.cos(a + 0.2) * 55, e.y + Math.sin(a + 0.2) * 55); ctx.stroke(); }
          break;
        }
        case 'glint': {                                   // 侍：刀のきらめき
          const s = Math.sin(p * Math.PI) * 18;
          ctx.fillStyle = '#ffffff'; ctx.beginPath();
          ctx.moveTo(e.x, e.y - s); ctx.lineTo(e.x + s * 0.2, e.y); ctx.lineTo(e.x, e.y + s); ctx.lineTo(e.x - s * 0.2, e.y); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(e.x - s, e.y); ctx.lineTo(e.x, e.y + s * 0.2); ctx.lineTo(e.x + s, e.y); ctx.lineTo(e.x, e.y - s * 0.2); ctx.closePath(); ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }

  // ---- A：字を持っているだけで出る演出 ----
  // 毎フレームの粒（火の粉・冷気・湯気など）
  // 鬱：ため息。口から白いもやが出て肩が落ち、弱音がふつうの対戦中のコメントと同じように出る
  const SIGH_LEN = 60, SIGH_BEND = 0.22;                         // ため息の長さ（フレーム）と、肩が落ちるときの前かがみの角度
  const SIGH_WORDS = [                                            // やる気の段階ごとの弱音（下がるほど重い）
    L(['はぁ…', 'だるい…', 'やる気でない…'], ['sigh…', 'meh…', 'so not in the mood…']),
    L(['はぁ〜…', '帰りたい…', 'もう無理…', 'どうせ負ける…', '布団に入りたい…'], ['siiigh…', 'wanna go home…', "I can't…", "what's the point…", 'need my bed…']),
  ];
  function sighOut(f) {
    if (f.sighCd > 0 || f.hp <= 0) return;
    f.sighCd = 45; f.sighT = SIGH_LEN;
    const words = SIGH_WORDS[f.gloom >= 3 ? 1 : 0];
    popText(f.x + rand(-20, 20), f.y - 220, words[Math.floor(Math.random() * words.length)], '#5a6a8a', 18 + f.gloom * 2);
  }
  function auraTick(f) {
    for (const p of f.trail) p.life--;
    f.trail = f.trail.filter((p) => p.life > 0);
    const fx = f.fx, t = f.t;
    // 鬱でやる気をなくした側：殴られたとき以外にも、ときどきため息をつく（やる気が下がるほど頻繁に）
    if (f.sighT > 0) f.sighT--;
    if (f.sighCd > 0) f.sighCd--;
    if (f.gloom > 0 && f.hp > 0 && !f.atk && match && match.phase === 'fight' && t % Math.max(70, 200 - f.gloom * 30) === 0) sighOut(f);
    if (!fx || f.hp <= 0) return;
    const g = f.weaponGeom(), rr = f.weapon.size * 0.35, at = (n) => t % n === 0;
    const near = () => [g.cx + rand(-rr, rr), g.cy + rand(-rr, rr)];
    switch (fx) {
      case 'burn': if (at(3)) { const [x, y] = near(); spark(x, y, Math.random() < 0.5 ? '#ff8a1f' : '#ffd84d', 1, 1, { vy: -1.5, g: -0.06 }); } break;
      case 'freeze': if (at(4)) { const [x, y] = near(); spark(x, y, 'rgba(210,235,255,0.9)', 1, 0.5, { g: 0.02 }); } break;
      case 'regen': if (at(12)) spark(f.x + rand(-25, 25), f.y - rand(20, 140), '#3cbf5a', 1, 0.5, { vy: -1, g: -0.02, ch: '✚' }); break;
      case 'gold': if (at(10)) { const [x, y] = near(); spark(x, y, '#fff6a0', 1, 0.3, { g: 0, ch: '✦' }); } break;
      case 'rage': if (at(f.hp < 50 ? 3 : 8)) spark(f.x + rand(-18, 18), f.y - 140, 'rgba(230,60,40,0.7)', 1, 0.8, { vy: -1.5, g: -0.05 }); break;
      case 'drunk': if (at(22)) spark(f.x + f.facing * 20, f.y - 150, '#ffffff', 1, 0.5, { vy: -1, g: -0.03, ch: '°' }); break;
      case 'iai': if (!f.atk && at(45)) { const [x, y] = near(); addFx('glint', x, y, { life: 14 }); } break;
      case 'god':                                                  // 神：足元から光の粒がこぼれる。滑って動くと、後ろに金色の光の筋が残る
        if (at(4)) spark(f.x + rand(-22, 22), f.y - godLift(f) + rand(-4, 4), '#fff6a0', 1, 0.4, { vy: 0.8, g: 0.01 });
        if (Math.abs(f.vx) > 0.6 && f.onGround && !f.atk && at(2)) {
          const d = Math.sign(f.vx);
          for (let i = 0; i < 2; i++) particles.push({ x: f.x - d * rand(10, 30), y: f.y - godLift(f) - rand(10, 170), vx: -d * 1.2, vy: 0, g: 0, life: 20, color: 'rgba(255,225,120,0.85)', r: 2, streak: true });
        }
        if (at(9)) spark(f.x + rand(-50, 50), f.y - rand(40, 190), '#ffe680', 1, 0.3, { vy: -0.6, g: -0.01, ch: '✦' });
        break;
    }
    // 速・馬・狼（遠吠えのあと）：走ると残像
    if ((fx === 'speed' || fx === 'swift' || (fx === 'howl' && f.howled)) && Math.abs(f.vx) > 3 && at(3)) f.trail.push({ x: f.x, y: f.y, life: 12 });
  }
  // 体の後ろに描くもの（後光・魔法陣・残像・うちわ・磁力線）
  function drawAuraBack(f, o) {
    const fx = f.fx;
    if (!fx || f.dust) return;
    ctx.save();
    for (const p of f.trail) {                                    // 残像
      ctx.globalAlpha = p.life / 30; ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.roundRect(p.x - 25, p.y - 95, 50, 60, 16); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y - 115, 26, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (fx === 'god') {                                           // 神：後光（浮いている高さに合わせる）
      const cx = f.x, cy = f.y - 110 - godLift(f);
      const gr = ctx.createRadialGradient(cx, cy, 10, cx, cy, 80);
      gr.addColorStop(0, 'rgba(255,240,150,0.9)'); gr.addColorStop(1, 'rgba(255,240,150,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, 80, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,90,0.7)'; ctx.lineWidth = 3;
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + f.t * 0.01; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); ctx.lineTo(cx + Math.cos(a) * 85, cy + Math.sin(a) * 85); ctx.stroke(); }
    }
    if (fx === 'magic') {                                         // 魔：足元の魔法陣
      ctx.translate(f.x, GROUND + 2); ctx.scale(1, 0.3); ctx.rotate(f.t * 0.03);
      ctx.strokeStyle = 'rgba(160,80,255,0.8)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 60, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i <= 5; i++) { const a = i * 4 * Math.PI / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * 44, Math.sin(a) * 44); } ctx.stroke();
    }
    ctx.restore(); ctx.save();
    if (fx === 'oshi') {                                          // 推：応援うちわ（ファンが振っている）
      const n = Math.min(5, Math.round((f.oshi - 1) / 0.15) + 1);
      for (let i = 0; i < n; i++) {
        const bx = f.x - f.facing * (48 + i * 30), by = f.y - 120 - (i % 2) * 24;
        const sway = Math.sin(f.t * 0.25 + i * 1.3) * 0.35;
        ctx.save(); ctx.translate(bx, by + 30); ctx.rotate(sway);
        ctx.fillStyle = '#c9a36b'; ctx.fillRect(-2.5, -6, 5, 34);                  // 柄
        ctx.translate(0, -26);
        ctx.fillStyle = ['#ff5b9a', '#ffd84d', '#5aa0ff', '#4cd964', '#ff8a1f'][i];
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 22); ctx.bezierCurveTo(-34, 14, -30, -26, 0, -24); ctx.bezierCurveTo(30, -26, 34, 14, 0, 22); ctx.fill(); ctx.stroke();   // うちわの面
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;                // 骨
        for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) { ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(Math.sin(a) * 26, 20 - Math.cos(a) * 40); ctx.stroke(); }
        ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('推', 0, -2);
        ctx.restore();
      }
    }
    if (fx === 'magnet' && o) {                                   // 磁：相手へ伸びる磁力線
      ctx.strokeStyle = 'rgba(90,160,255,0.45)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -f.t;
      for (const k of [-30, 0, 30]) { ctx.beginPath(); ctx.moveTo(f.x, f.y - 90); ctx.quadraticCurveTo((f.x + o.x) / 2, f.y - 90 + k * 2, o.x, o.y - 90); ctx.stroke(); }
    }
    ctx.restore();
  }
  // 体の前に描くもの（雷の放電）
  function drawAuraFront(f) {
    const fx = f.fx;
    if (f.dust) return;
    ctx.save();
    if (fx === 'souls' && f.hp > 0) for (const s of soulOrbs(f)) drawWisp(s.x, s.y, 9, f.t + s.a * 10, s.front ? 1 : 0.55);   // 魂：まわりを回る人魂
    if (fx === 'stun' && f.t % 50 < 5) {                           // 雷：字がときどき放電
      const g = f.weaponGeom();
      ctx.strokeStyle = '#fff59a'; ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 10; ctx.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath(); let x = g.cx, y = g.cy; ctx.moveTo(x, y);
        for (let i = 0; i < 4; i++) { x += rand(-22, 22); y += rand(-22, 22); ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSwamps() {
    for (const s of swamps) {
      ctx.save(); ctx.globalAlpha = Math.min(1, s.life / 30);
      ctx.fillStyle = '#5e4a22'; ctx.strokeStyle = '#3b2e14'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, GROUND + 3, 52, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  // ---- 新しい字の小物の絵（原点を中心に描く）----
  const NETA = { tuna: ['#d9304a', '#f06a7e'], salmon: ['#ff8a50', '#ffd0b0'], squid: ['#f4f1e6', '#ffffff'], egg: ['#ffd34d', '#fff0a0'], shrimp: ['#ff7a4d', '#ffffff'] };
  function drawSushi(neta, s) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-20, -2, 40, 16, 7); ctx.fill(); ctx.stroke();      // シャリ
    const [c1, c2] = NETA[neta] || NETA.tuna;
    ctx.fillStyle = c1; ctx.beginPath(); ctx.roundRect(-23, -11, 46, 13, 6); ctx.fill();   // ネタ
    ctx.strokeStyle = c2; ctx.lineWidth = 2;
    if (neta === 'salmon' || neta === 'shrimp') for (const x of [-12, -2, 8]) { ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x + 6, 1); ctx.stroke(); }
    if (neta === 'egg') { ctx.fillStyle = '#1e2a1e'; ctx.fillRect(-4, -12, 8, 27); }   // 玉子ののり
    ctx.restore();
  }
  function drawNegi(s) {                                           // 長ネギ：白い茎が上で緑になり、Yの字に分かれる（太い黒の縁取り）
    ctx.save(); ctx.scale(s, s); ctx.rotate(0.25);
    ctx.beginPath();
    ctx.moveTo(-5, 52); ctx.quadraticCurveTo(-6, 10, -6, -18);       // 茎の左
    ctx.quadraticCurveTo(-8, -44, -8, -62);                         // 左の葉の外側
    ctx.quadraticCurveTo(-4, -66, 2, -64);                          // 左の葉の先
    ctx.quadraticCurveTo(0, -46, 2, -30);                           // 左の葉の内側（切れ込み）
    ctx.lineTo(16, -60);                                            // 右の葉の内側
    ctx.quadraticCurveTo(21, -60, 22, -55);                         // 右の葉の先
    ctx.quadraticCurveTo(10, -36, 6, -16);                          // 右の葉の外側
    ctx.quadraticCurveTo(5, 10, 5, 52);                             // 茎の右
    ctx.quadraticCurveTo(0, 56, -5, 52); ctx.closePath();          // 根もと
    const gr = ctx.createLinearGradient(0, -64, 0, 52);
    gr.addColorStop(0, '#5ab44c'); gr.addColorStop(0.36, '#5ab44c'); gr.addColorStop(0.47, '#ffffff'); gr.addColorStop(1, '#ffffff');
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.restore();
  }
  function drawDumbbell(s) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(-26, -3, 52, 6);
    ctx.fillStyle = '#2b2e33'; ctx.strokeStyle = '#555b63'; ctx.lineWidth = 1.5;
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.roundRect(d * 18 - 6, -14, 12, 28, 3); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.roundRect(d * 27 - 4, -10, 8, 20, 2); ctx.fill(); }
    ctx.restore();
  }
  function drawInvoice(s) {                                        // 税の請求書（金の札束 drawBill とは別）
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = '#fffdf6'; ctx.strokeStyle = '#8a8070'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(-18, -24, 36, 48); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c0392b'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(L('請求書', 'BILL'), 0, -15);
    ctx.strokeStyle = '#b8b0a0'; ctx.lineWidth = 1; for (let y = -6; y <= 14; y += 5) { ctx.beginPath(); ctx.moveTo(-12, y); ctx.lineTo(12, y); ctx.stroke(); }
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(10, 17, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawWisp(x, y, r, t, alpha) {                           // 人魂（青白い炎）
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha; ctx.translate(x, y);
    const gr = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 1.8);
    gr.addColorStop(0, 'rgba(160,215,255,0.85)'); gr.addColorStop(0.45, 'rgba(70,140,255,0.5)'); gr.addColorStop(1, 'rgba(40,90,255,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(140,200,255,0.9)';
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.quadraticCurveTo(-r * 0.6, -r * 1.6, Math.sin(t * 0.3) * r * 0.5, -r * 2.4); ctx.quadraticCurveTo(r * 0.6, -r * 1.6, r, 0); ctx.arc(0, 0, r, 0, Math.PI); ctx.fill();
    ctx.restore();
  }
  // 雪：雪だるま（x は足もと、dir は顔の向き）。太めの縁取りのやさしい絵柄
  function drawSnowman(x, y, dir, t) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 0.3) * 0.06); ctx.scale(1.15, 1.15);   // 転がりながらゆらゆら。キャラが隠れるよう少し大きめ
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const OL = '#4a4f5a';
    // 小枝の腕（3本指）
    ctx.strokeStyle = '#6b4424'; ctx.lineWidth = 5;
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(d * 30, -70); ctx.lineTo(d * 66, -96); ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(d * 58, -91); ctx.lineTo(d * 62, -110); ctx.moveTo(d * 62, -93); ctx.lineTo(d * 78, -98); ctx.moveTo(d * 52, -86); ctx.lineTo(d * 60, -76); ctx.stroke();
      ctx.lineWidth = 5;
    }
    // 体と頭
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = OL; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, -44, 48, 44, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -112, 33, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(150,185,225,0.35)';                                  // 雪の陰
    ctx.beginPath(); ctx.ellipse(10 * -dir, -30, 34, 26, 0, 0, TAU); ctx.fill();
    // ボタン（炭）
    ctx.fillStyle = '#2b2b30'; for (const by of [-58, -40, -22]) { ctx.beginPath(); ctx.arc(0, by, 4.5, 0, TAU); ctx.fill(); }
    // 顔：炭の目、にんじんの鼻、にっこり口、ほっぺ
    ctx.save(); ctx.scale(dir, 1);
    ctx.fillStyle = '#2b2b30'; ctx.beginPath(); ctx.arc(-4, -120, 3.8, 0, TAU); ctx.arc(14, -120, 3.8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f08a24'; ctx.strokeStyle = '#b85a10'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(6, -112); ctx.lineTo(34, -106); ctx.lineTo(6, -103); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#2b2b30'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(6, -100, 9, 0.35, Math.PI - 0.35); ctx.stroke();
    ctx.fillStyle = 'rgba(255,120,140,0.45)'; ctx.beginPath(); ctx.ellipse(-12, -104, 5, 3, 0, 0, TAU); ctx.ellipse(24, -104, 5, 3, 0, 0, TAU); ctx.fill();
    ctx.restore();
    // マフラー（赤と白のしま）：首まわりと、垂れた端
    ctx.lineWidth = 3; ctx.strokeStyle = OL;
    ctx.save(); ctx.beginPath(); ctx.roundRect(-34, -88, 68, 16, 8); ctx.clip();
    for (let i = -40; i < 40; i += 12) { ctx.fillStyle = (i / 12) % 2 ? '#e8414a' : '#ffffff'; ctx.fillRect(i, -90, 12, 20); }
    ctx.restore(); ctx.beginPath(); ctx.roundRect(-34, -88, 68, 16, 8); ctx.stroke();
    const ex = -dir * 18;
    ctx.save(); ctx.beginPath(); ctx.roundRect(ex - 8, -76, 16, 34, 4); ctx.clip();
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#e8414a'; ctx.fillRect(ex - 9, -76 + i * 12, 18, 12); }
    ctx.restore(); ctx.beginPath(); ctx.roundRect(ex - 8, -76, 16, 34, 4); ctx.stroke();
    // 紺のバケツ帽子（白い帯）
    ctx.save(); ctx.translate(dir * 6, -140); ctx.rotate(dir * 0.18);
    ctx.fillStyle = '#2c3f78'; ctx.strokeStyle = OL; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(-20, 4); ctx.lineTo(-15, -26); ctx.lineTo(15, -26); ctx.lineTo(20, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-18, -6, 36, 6); ctx.strokeRect(-18, -6, 36, 6);
    ctx.restore();
    ctx.restore();
  }
  function drawGhost(x, y, s, t, dir) {                            // お化け
    ctx.save(); ctx.translate(x, y); ctx.scale(s * dir, s);
    ctx.fillStyle = 'rgba(235,242,255,0.88)'; ctx.strokeStyle = 'rgba(120,140,190,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-22, 10); ctx.bezierCurveTo(-26, -40, 26, -40, 22, 10);
    for (let i = 0; i < 4; i++) { const x0 = 22 - i * 11; ctx.quadraticCurveTo(x0 - 3, 22 + Math.sin(t * 0.4 + i) * 4, x0 - 11, 14); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#223'; ctx.beginPath(); ctx.ellipse(-6, -10, 3, 5, 0, 0, TAU); ctx.ellipse(8, -10, 3, 5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2, 2, 4, 5, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawRock(s, seed) {                                     // ごつごつした岩
    ctx.save(); ctx.scale(s, s);
    const n = 9, pts = [];
    for (let i = 0; i < n; i++) { const a = i * TAU / n, r = 20 * (0.78 + 0.22 * Math.abs(Math.sin(seed * 3.1 + i * 1.7))); pts.push([Math.cos(a) * r * 1.15, Math.sin(a) * r * 0.9]); }
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    const gr = ctx.createLinearGradient(-14, -18, 12, 18); gr.addColorStop(0, '#b8ada0'); gr.addColorStop(1, '#6e6358');
    ctx.fillStyle = gr; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 2.2; ctx.strokeStyle = '#2e2822'; ctx.stroke();
    ctx.strokeStyle = 'rgba(46,40,34,0.6)'; ctx.lineWidth = 1.4;                    // ひび
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(0, -1); ctx.lineTo(-3, 7); ctx.moveTo(0, -1); ctx.lineTo(8, 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(-8, -8, 6, 3, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawObj(obj, neta, s, seed) {
    if (obj === 'lawbook') { drawLawbook(s); return; }
    if (obj === 'rock') drawRock(s, seed || 1); else if (obj === 'negi') drawNegi(s); else if (obj === 'dumbbell') drawDumbbell(s); else if (obj === 'bill') drawInvoice(s); else drawSushi(neta, s);
  }
  // 法：六法全書（分厚い本。表紙は紺、背に金の字）
  function drawLawbook(s) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = '#f4efe0'; ctx.strokeStyle = '#b8ae90'; ctx.lineWidth = 1;
    ctx.fillRect(-22, -30, 48, 58);                                          // ページの束（厚み）
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(-20, -27 + i * 7); ctx.lineTo(25, -27 + i * 7); ctx.stroke(); }
    ctx.fillStyle = '#1f3a6e'; ctx.strokeStyle = '#0e1d3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-26, -32, 44, 60, 3); ctx.fill(); ctx.stroke();   // 表紙
    ctx.fillStyle = '#16305a'; ctx.fillRect(-26, -32, 8, 60);                 // 背
    ctx.strokeStyle = '#d8b24a'; ctx.lineWidth = 1.2; ctx.strokeRect(-14, -26, 26, 48);
    ctx.fillStyle = '#e8c45a'; ctx.font = '900 9px "Noto Sans JP", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['六', '法', '全', '書'].forEach((c, i) => ctx.fillText(c, -1, -16 + i * 11));
    ctx.restore();
  }
  // 竜：横向きの竜の首と頭のシルエット（原点＝首の根もと、右向き）。open は口の開き
  function drawDragon(open, t, c1, c2) {
    const g = ctx.createLinearGradient(0, -260, 0, 0); g.addColorStop(0, c2); g.addColorStop(1, c1);
    ctx.fillStyle = g; ctx.strokeStyle = '#1a0503'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-60, 0); ctx.quadraticCurveTo(-70, -150, 0, -200); ctx.quadraticCurveTo(40, -230, 80, -215);   // 首の後ろ
    ctx.lineTo(150, -205); ctx.lineTo(160, -190 + open * 4);                                                              // 上あご
    ctx.lineTo(95, -185 + open * 6); ctx.lineTo(150, -180 + open * 30); ctx.lineTo(140, -168 + open * 34); ctx.lineTo(80, -165 + open * 14);   // 口と下あご
    ctx.quadraticCurveTo(20, -150, 40, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(60, -222); ctx.lineTo(20, -268); ctx.lineTo(48, -226); ctx.fill(); ctx.stroke();            // 角
    ctx.beginPath(); ctx.moveTo(40, -215); ctx.lineTo(-12, -246); ctx.lineTo(28, -210); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-58 + i * 4, -30 - i * 30); ctx.lineTo(-84 + i * 6, -45 - i * 30); ctx.lineTo(-50 + i * 6, -50 - i * 30); ctx.fill(); }   // 背びれ
    ctx.fillStyle = '#ffd84d'; ctx.shadowColor = '#ff8a1f'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.ellipse(100, -205, 9, 5, -0.2, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    if (open > 0.3) { ctx.fillStyle = 'rgba(255,140,30,0.8)'; ctx.beginPath(); ctx.arc(150, -185 + open * 14, 10 + Math.sin(t) * 3, 0, TAU); ctx.fill(); }
  }
  // 龍・龘：龍の頭（原点＝頭の中心、上向き）
  function drawDragonHead(s, col, eye, t) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = col; ctx.strokeStyle = '#3a0805'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-22, 20); ctx.quadraticCurveTo(-30, -20, -12, -48); ctx.lineTo(12, -48); ctx.quadraticCurveTo(30, -20, 22, 20); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-14, -30); ctx.lineTo(-34, -62); ctx.lineTo(-8, -40); ctx.moveTo(14, -30); ctx.lineTo(34, -62); ctx.lineTo(8, -40); ctx.stroke();   // 角
    ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -46); ctx.quadraticCurveTo(-40, -50 + Math.sin(t * 0.3) * 6, -54, -30); ctx.moveTo(10, -46); ctx.quadraticCurveTo(40, -50 - Math.sin(t * 0.3) * 6, 54, -30); ctx.stroke();   // ひげ
    ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(-11, -6, 5, 0, TAU); ctx.arc(11, -6, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(-12, -10, 2, 8); ctx.fillRect(10, -10, 2, 8);
    ctx.fillStyle = '#fff'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 6 - 3, -44); ctx.lineTo(i * 6, -52); ctx.lineTo(i * 6 + 3, -44); ctx.fill(); }   // 牙
    ctx.restore();
  }
  // 蘇：炎の不死鳥（原点＝胴、右向き）
  function drawPhoenix(s, t) {
    ctx.save(); ctx.scale(s, s);
    const flap = Math.sin(t * 0.6) * 0.6;
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {                                                           // 翼（炎の羽）
      ctx.save(); ctx.rotate(side * (0.3 + flap * 0.5)); 
      for (let i = 0; i < 5; i++) { const g = ctx.createLinearGradient(0, 0, -40 + i * 10, -side * 90); g.addColorStop(0, 'rgba(255,240,160,0.9)'); g.addColorStop(1, 'rgba(230,60,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.quadraticCurveTo(-30 + i * 8, -side * 50, -50 + i * 14, -side * (70 + i * 6)); ctx.quadraticCurveTo(-10 + i * 6, -side * 30, 14, 0); ctx.fill(); }
      ctx.restore();
    }
    for (let i = 0; i < 3; i++) { const g = ctx.createLinearGradient(-10, 0, -110, 0); g.addColorStop(0, 'rgba(255,200,60,0.9)'); g.addColorStop(1, 'rgba(230,40,10,0)'); ctx.strokeStyle = g; ctx.lineWidth = 6 - i; ctx.beginPath(); ctx.moveTo(-10, 4); ctx.quadraticCurveTo(-60, 10 + i * 12 + Math.sin(t * 0.4 + i) * 8, -120, 4 + i * 18); ctx.stroke(); }   // 尾
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(4, 0, 2, 4, 0, 24); g.addColorStop(0, '#fff6c0'); g.addColorStop(0.6, '#ff8a1f'); g.addColorStop(1, '#c8281a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(4, 0, 24, 13, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(28, -8, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.moveTo(36, -8); ctx.lineTo(48, -4); ctx.lineTo(36, -2); ctx.fill();   // くちばし
    ctx.fillStyle = '#ff5a1a'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(24 + i * 3, -16); ctx.lineTo(16 + i * 6, -34 - i * 3); ctx.lineTo(30 + i * 3, -16); ctx.fill(); }   // とさか
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(31, -10, 2, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 犬：柴犬（原点＝足元、右向き）
  function drawDog(s, t) {
    ctx.save(); ctx.scale(s, s); ctx.lineJoin = 'round'; ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 2;
    const leg = Math.sin(t * 1.2) * 6;
    ctx.fillStyle = '#d9893a';
    for (const [x, d] of [[-16, 1], [14, -1]]) { ctx.beginPath(); ctx.roundRect(x - 3 + leg * d * 0.4, -14, 7, 14, 3); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(0, -20, 26, 13, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff4e0'; ctx.beginPath(); ctx.ellipse(4, -14, 16, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d9893a'; ctx.beginPath(); ctx.arc(-28, -34, 9, 0.5, TAU - 0.5); ctx.lineWidth = 6; ctx.strokeStyle = '#d9893a'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#3a2210';   // 巻いたしっぽ
    ctx.beginPath(); ctx.arc(26, -34, 14, 0, TAU); ctx.fill(); ctx.stroke();                                 // 頭
    ctx.beginPath(); ctx.moveTo(18, -44); ctx.lineTo(20, -58); ctx.lineTo(28, -46); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(28, -46); ctx.lineTo(34, -58); ctx.lineTo(37, -42); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff4e0'; ctx.beginPath(); ctx.ellipse(34, -29, 9, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(41, -31, 2.5, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(29, -37, 2, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 狼：跳びかかる灰色の狼（原点＝胴、右向き）
  function drawWolf(s) {
    ctx.save(); ctx.scale(s, s); ctx.fillStyle = '#5a6070'; ctx.strokeStyle = '#2a2e38'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-40, -4); ctx.quadraticCurveTo(-70, -10, -80, 6); ctx.quadraticCurveTo(-60, 2, -38, 8); ctx.closePath(); ctx.fill(); ctx.stroke();   // しっぽ
    ctx.beginPath(); ctx.ellipse(0, 0, 40, 15, 0, 0, TAU); ctx.fill(); ctx.stroke();
    for (const [x, a] of [[-28, 0.9], [-20, 1.1], [26, -0.9], [32, -0.6]]) { ctx.save(); ctx.translate(x, 8); ctx.rotate(a); ctx.fillRect(-3, 0, 7, 24); ctx.restore(); }
    ctx.beginPath(); ctx.moveTo(30, -12); ctx.lineTo(52, -20); ctx.lineTo(74, -8); ctx.lineTo(52, 2); ctx.lineTo(34, 8); ctx.closePath(); ctx.fill(); ctx.stroke();   // 頭と鼻先
    ctx.beginPath(); ctx.moveTo(42, -16); ctx.lineTo(44, -34); ctx.lineTo(52, -20); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(56, -12, 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(62, -2); ctx.lineTo(64, 4); ctx.lineTo(66, -2); ctx.fill();
    ctx.restore();
  }
  // 牙：巨大なあご（dir=1 下あご・歯が上向き、-1 上あご）
  function drawJaw(x, y, dir, k) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, dir);
    ctx.fillStyle = '#7a1020'; ctx.strokeStyle = '#3a0508'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-170, 0); ctx.quadraticCurveTo(0, 60, 170, 0); ctx.lineTo(170, 40); ctx.quadraticCurveTo(0, 100, -170, 40); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fbf6e8'; ctx.strokeStyle = '#8a7a6a'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const q = i / 8, tx = -150 + q * 300, ty = Math.sin(q * Math.PI) * 28, big = i === 1 || i === 7; ctx.beginPath(); ctx.moveTo(tx - 14, ty + 6); ctx.lineTo(tx, ty - (big ? 64 : 36)); ctx.lineTo(tx + 14, ty + 6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  // 呪：お札（原点が中心）
  function drawOfuda(s) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = '#f6eec8'; ctx.strokeStyle = '#a08a50'; ctx.lineWidth = 1.5; ctx.fillRect(-11, -30, 22, 60); ctx.strokeRect(-11, -30, 22, 60);
    ctx.strokeStyle = '#b8201a'; ctx.lineWidth = 2; ctx.strokeRect(-8, -27, 16, 54);
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const y = -20 + i * 8; ctx.moveTo(-5, y); ctx.quadraticCurveTo(0, y - 4, 5, y + 2); } ctx.stroke();
    ctx.restore();
  }
  // 猫（原点が中心、右向き）。paw=true で肉球パンチ
  function drawCat(s, col, paw, t) {
    ctx.save(); ctx.scale(s, s); ctx.fillStyle = col; ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-18, 6); ctx.quadraticCurveTo(-40, -6 + Math.sin(t * 0.5) * 6, -34, -26); ctx.lineWidth = 5; ctx.strokeStyle = col; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#3a2a20';   // しっぽ
    ctx.beginPath(); ctx.ellipse(-4, 8, 20, 14, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(14, -10, 15, 0, TAU); ctx.fill(); ctx.stroke();
    for (const x of [4, 20]) { ctx.beginPath(); ctx.moveTo(x - 6, -20); ctx.lineTo(x, -34); ctx.lineTo(x + 6, -20); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(10, -12, 2, 0, TAU); ctx.arc(21, -12, 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(15, -6); ctx.lineTo(13, -3); ctx.moveTo(15, -6); ctx.lineTo(17, -3); ctx.stroke();
    ctx.fillStyle = col; ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 2;
    const px = paw ? 40 : 22, py = paw ? -4 : 14;                                           // 前足（パンチ）
    ctx.beginPath(); ctx.moveTo(8, 4); ctx.lineTo(px, py); ctx.lineWidth = 9; ctx.strokeStyle = col; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#3a2a20';
    ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff9ab8'; ctx.beginPath(); ctx.arc(px + 2, py + 1, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 酔：一升瓶（原点が中心）
  function drawBottle(s) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(40,120,60,0.9)'; ctx.strokeStyle = '#1a4a24'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, -46); ctx.lineTo(6, -46); ctx.lineTo(6, -28); ctx.quadraticCurveTo(14, -22, 14, -10); ctx.lineTo(14, 40); ctx.lineTo(-14, 40); ctx.lineTo(-14, -10); ctx.quadraticCurveTo(-14, -22, -6, -28); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f6f0e0'; ctx.fillRect(-11, -6, 22, 30);
    ctx.fillStyle = '#c0392b'; ctx.font = '900 14px "Noto Sans JP", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(L('酒', 'SAKE'), 0, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-10, -20, 4, 50);
    ctx.restore();
  }
  // 麺：ラーメン丼（原点＝丼の底、地面）
  function drawRamenBowl(t) {
    ctx.fillStyle = '#c8281a'; ctx.strokeStyle = '#5a0f08'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-70, -80); ctx.quadraticCurveTo(-64, -10, -26, 0); ctx.lineTo(26, 0); ctx.quadraticCurveTo(64, -10, 70, -80); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath();                            // 雷紋
    for (let i = 0; i < 7; i++) { const x = -54 + i * 18; ctx.moveTo(x, -60); ctx.lineTo(x + 10, -60); ctx.lineTo(x + 10, -50); ctx.lineTo(x + 4, -50); }
    ctx.stroke();
    ctx.fillStyle = '#e8b04a'; ctx.beginPath(); ctx.ellipse(0, -80, 70, 14, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f6d878'; ctx.lineWidth = 3; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-50 + i * 18, -84); ctx.quadraticCurveTo(-40 + i * 18, -74, -30 + i * 18, -84); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-30, -82, 12, 6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#f6c21a'; ctx.beginPath(); ctx.arc(-30, -82, 4, 0, TAU); ctx.fill();   // 味玉
    ctx.fillStyle = '#c87a50'; ctx.beginPath(); ctx.ellipse(28, -82, 14, 8, 0.2, 0, TAU); ctx.fill();   // チャーシュー
  }
  // 拳：横から見た握りこぶし（d=1 で右向き）。袖はキャラの道着の色
  function drawFistArt(s, side) {
    ctx.save(); ctx.scale(s, s);
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.5; ctx.strokeStyle = '#3a2210';
    ctx.fillStyle = side === 1 ? '#2f5fc0' : '#c8322a';                     // 袖
    ctx.beginPath(); ctx.roundRect(-46, -13, 24, 26, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f2c79a';                                                 // 手首とこぶし
    ctx.beginPath(); ctx.roundRect(-26, -10, 14, 20, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-16, -16, 30, 32, 10); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#a0704a'; ctx.lineWidth = 1.8;                          // 指の線
    for (const y of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(13, y); ctx.stroke(); }
    ctx.fillStyle = '#e8b888'; ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 2;  // 親指
    ctx.beginPath(); ctx.ellipse(-2, 9, 10, 5, -0.2, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(2, -10, 8, 3, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 草：草むら（葉が何本も）。w=true なら「w」の形の草
  function drawGrassArt(s, w, t) {
    ctx.save(); ctx.scale(s, s); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (w) {
      for (const [col, lw] of [['#1f6a1a', 13], ['#4cb83a', 8], ['#a6e07a', 2.5]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(-34, -70); ctx.lineTo(-18, 0); ctx.lineTo(0, -46); ctx.lineTo(18, 0); ctx.lineTo(34, -70); ctx.stroke();
      }
    } else {
      const blades = [[-26, -58, -0.35], [-14, -82, -0.15], [0, -100, 0.02], [12, -78, 0.18], [26, -60, 0.4], [-6, -64, -0.05], [18, -50, 0.3]];
      for (const [x, h, lean] of blades) {
        const sw = Math.sin(t * 0.18 + x) * 4, tx = x + lean * -h + sw;
        ctx.fillStyle = '#3f9a2f'; ctx.strokeStyle = '#1f5a1a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.quadraticCurveTo(x - 4 + (tx - x) * 0.3, h * 0.5, tx, h); ctx.quadraticCurveTo(x + 4 + (tx - x) * 0.3, h * 0.5, x + 6, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(190,240,140,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, -4); ctx.quadraticCurveTo(x + (tx - x) * 0.3, h * 0.5, tx, h + 6); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // 忍：手裏剣（4つ刃、真ん中に穴）
  function drawShuriken(r, rot) {
    ctx.save(); ctx.rotate(rot);
    ctx.fillStyle = '#4a5260'; ctx.strokeStyle = '#1c2028'; ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a + Math.PI / 4) * r * 0.3, Math.sin(a + Math.PI / 4) * r * 0.3); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,230,245,0.8)'; ctx.lineWidth = Math.max(1, r * 0.04);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(Math.cos(a + 0.4) * r * 0.25, Math.sin(a + 0.4) * r * 0.25); ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); ctx.stroke(); }
    ctx.fillStyle = '#d8dde6'; ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // 球：野球のボール（白に赤い縫い目）
  function drawBaseball(r) {
    ctx.save();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#d33'; ctx.lineWidth = Math.max(1.5, r * 0.1);
    for (const d of [-1, 1]) {
      const c0 = d < 0 ? 0 : Math.PI;                                          // 左右の縫い目は、外側の円の内向きの弧
      ctx.beginPath(); ctx.arc(d * r * 1.35, 0, r * 0.95, c0 - 0.75, c0 + 0.75); ctx.stroke();
    }
    ctx.restore();
  }
  // 蜂（x, y が中心、dir は向き）
  function drawBee(x, y, dir, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * 1.5, 1.5);
    const flap = Math.sin(t * 2.2 + x) * 0.5;
    ctx.fillStyle = 'rgba(230,245,255,0.85)'; ctx.strokeStyle = 'rgba(120,140,160,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(-1, -8, 6, 9, -0.5 + flap, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(4, -8, 5, 8, 0.4 - flap, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f6c21a'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 7.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.fillRect(-4, -7, 3, 14); ctx.fillRect(2, -7, 3, 14);
    ctx.beginPath(); ctx.moveTo(-11, -2); ctx.lineTo(-17, 0); ctx.lineTo(-11, 2); ctx.fill();     // 針
    ctx.beginPath(); ctx.arc(10, -2, 5, 0, TAU); ctx.fill();                                    // 頭
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(11.5, -3, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 蛇：体に巻きつくとぐろ（後ろ側を暗く、手前を明るく）。grow 0〜1 で下から巻いていく。head=1 なら小さな頭もつける
  function drawSnakeCoil(cx, yb, yt, rx, turns, lw, grow, t, head, cols) {
    const [cF, cB, cH] = cols || ['#2f7a2c', '#1d4f1c', '#a8d870'];
    const N = Math.max(2, Math.round(60 * grow)), pts = [];
    for (let i = 0; i <= N; i++) { const q = i / 60, a = q * turns * TAU; pts.push([cx + Math.cos(a) * rx, yb + (yt - yb) * q + Math.sin(a) * rx * 0.22, Math.sin(a)]); }
    ctx.save(); ctx.lineCap = 'round';
    for (const front of [false, true]) {
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0, z0] = pts[i - 1], [x1, y1] = pts[i];
        if ((z0 > 0) !== front) continue;
        ctx.strokeStyle = front ? cF : cB; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        if (front) { ctx.strokeStyle = cH; ctx.lineWidth = lw * 0.32; ctx.beginPath(); ctx.moveTo(x0, y0 - lw * 0.18); ctx.lineTo(x1, y1 - lw * 0.18); ctx.stroke(); }
        if (front && i % 4 === 0 && !cols) { ctx.fillStyle = cB; ctx.beginPath(); ctx.arc(x1, y1 + lw * 0.12, lw * 0.16, 0, TAU); ctx.fill(); }
      }
    }
    ctx.restore();
    if (head && pts.length > 1) { const [x, y] = pts[pts.length - 1]; drawSnakeHead(x, y - 6, x > cx ? 1 : -1, lw / 14, false, t); }
  }
  function drawSnakeHead(x, y, dir, s, open, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
    if (open || Math.sin(t * 0.4) > 0.3) {                                    // 舌をチロチロ
      ctx.strokeStyle = '#d0263a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(14, 3); ctx.lineTo(24, 3); ctx.lineTo(28, 0); ctx.moveTo(24, 3); ctx.lineTo(28, 6); ctx.stroke();
    }
    ctx.fillStyle = '#2f7a2c'; ctx.strokeStyle = '#163d15'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(2, 0, 15, 10, 0, 0, TAU); ctx.fill(); ctx.stroke();
    if (open) { ctx.fillStyle = '#7a1020'; ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(18, -2); ctx.lineTo(18, 10); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(14, 0, 2, 4); }
    ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(7, -4, 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(6.4, -6.5, 1.4, 5);
    ctx.restore();
  }
  // 影分身・幻：キャラを別の場所に描く（filter で黒い影や半透明にする）。atk を渡すとその技の格好で
  function drawGhostOf(f, x, y, facing, filter, alpha, atk) {
    if (alpha <= 0.01 || f.dust) return;
    const keep = { x: f.x, y: f.y, facing: f.facing, atk: f.atk, gripShift: f.gripShift, invis: f.invis, squash: f.squash, down: f.down };
    f.x = x; f.y = y; f.facing = facing; f.invis = 0; f.squash = 0; f.down = 0;
    if (atk !== undefined) f.atk = atk;
    ctx.save(); ctx.globalAlpha = alpha; if (filter && 'filter' in ctx) ctx.filter = filter;
    try {
      drawCapsuleBody(f);
      const g = f.weaponGeom(), gs = f.gripShift && clearOfBody(f, g, f.gripShift);
      if (gs) ctx.translate(gs.x, gs.y);
      drawWeaponGlyph(f.weapon, g.cx, g.cy, f.weapon.size, g.rot);
    } finally {
      ctx.restore();
      Object.assign(f, keep);
    }
  }
  function drawProjectiles() {
    for (const p of projectiles) {
      ctx.save(); ctx.translate(p.x, p.y);
      if (p.kind === 'arrow') {
        const d = sign(p.vx);
        ctx.strokeStyle = '#5a3b1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-d * 30, 0); ctx.lineTo(d * 8, 0); ctx.stroke();
        ctx.fillStyle = '#888'; ctx.beginPath(); ctx.moveTo(d * 16, 0); ctx.lineTo(d * 4, -7); ctx.lineTo(d * 4, 7); ctx.fill();
        ctx.fillStyle = '#d33'; ctx.fillRect(-d * 32 - 3, -5, 8, 10);
      } else if (p.kind === 'fire') {
        const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, p.r * 1.4);
        gr.addColorStop(0, '#fff6a0'); gr.addColorStop(0.5, '#ff8a1f'); gr.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, p.r * 1.4, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'bullet') {
        ctx.fillStyle = '#c9a020'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'shuriken' || p.kind === 'heart') {
        ctx.rotate(p.kind === 'shuriken' ? p.life * 0.5 : 0);
        ctx.fillStyle = p.kind === 'shuriken' ? '#445' : '#ff3d8a';
        ctx.font = `bold ${p.r * 2.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.kind === 'shuriken' ? '✦' : '♥', 0, 0);
      } else if (p.kind === 'boomer') {
        Texture.draw(ctx, p.owner.weapon.ch, 0, 0, Math.round(p.size || 44), weaponStyle(p.owner.weapon), p.life * 0.45);   // 手に持っていた卍そのものが回って飛ぶ
      } else if (p.kind === 'word') {                                // 母の小言
        ctx.font = `bold ${EN ? 18 : 22}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = '#c0392b'; ctx.fillText(p.text, 0, 0);
      } else if (p.kind === 'rock') {                                // 岩：投げた岩
        ctx.rotate((120 - p.life) * p.spin); drawRock(1, p.seed);
      } else if (p.kind === 'sushi') {                               // 鮨：投げた寿司
        ctx.rotate(p.life * 0.25 * sign(p.vx)); drawSushi(p.neta, 1);
      } else if (p.kind === 'bouncer') {                             // 球：投げた球
        ctx.globalAlpha = Math.min(1, p.life / 20); ctx.rotate(p.life * 0.3 * sign(p.vx)); drawBaseball(p.r);
      } else if (p.kind === 'kickball') {                            // 蹴：蹴った字（炎をまとって飛ぶ）
        const gr = ctx.createRadialGradient(0, 0, 4, 0, 0, p.size * 0.75);
        gr.addColorStop(0, 'rgba(255,240,160,0.8)'); gr.addColorStop(0.6, 'rgba(255,120,30,0.45)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, p.size * 0.75, 0, TAU); ctx.fill();
        Texture.draw(ctx, p.owner.weapon.ch, 0, 0, Math.round(p.size), weaponStyle(p.owner.weapon), p.life * 0.5 * sign(p.vx));
      } else if (p.kind === 'wave') {
        ctx.fillStyle = 'rgba(70,150,230,0.75)'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-40, 30);
        ctx.quadraticCurveTo(-30, -40, 10 * sign(p.vx), -30); ctx.quadraticCurveTo(40 * sign(p.vx), -20, 40, 30);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-5, -5, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // 背景が暗くても読めるように、白いふち付きで書く
  function outlined(str, x, y, color) {
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color || '#222'; ctx.fillText(str, x, y);
  }
  function drawHud(m) {
    const bw = W / 2 - (portrait ? 60 : 80), bh = 22;
    const bar = (x, f, alignRight, label) => {
      ctx.fillStyle = '#222'; ctx.fillRect(x - 3, 27, bw + 6, bh + 6);
      ctx.fillStyle = '#eee'; ctx.fillRect(x, 30, bw, bh);
      const fw = bw * f.hp / 100;
      ctx.fillStyle = f.hp > 30 ? '#4cd964' : '#ff3b30';
      ctx.fillRect(alignRight ? x + bw - fw : x, 30, fw, bh);
      // 必殺ゲージ（満タンで光る）
      const gw = bw * 0.62, gx = alignRight ? x + bw - gw : x, full = f.sp >= 100;
      ctx.fillStyle = '#222'; ctx.fillRect(gx - 2, 84, gw + 4, 12);
      ctx.fillStyle = full ? (m.frame % 16 < 8 ? '#fff27a' : '#ffb52e') : '#e0a020';
      const sw = gw * Math.min(1, f.sp / 100);
      ctx.fillRect(alignRight ? gx + gw - sw : gx, 86, sw, 8);
      // 何のゲージか書いておく（緑＝HP、黄色＝必殺。必殺は殴られると溜まる）
      ctx.save();
      ctx.font = 'bold 13px sans-serif'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.fillStyle = '#ffffff';
      const hx = alignRight ? x + bw - 6 : x + 6;
      ctx.strokeText('HP', hx, 41); ctx.fillText('HP', hx, 41);
      ctx.font = 'bold 14px sans-serif';
      const spLabel = full ? L('必殺 MAX!', 'SUPER MAX!') : L('必殺', 'SUPER');
      const lx = alignRight ? gx - 6 : gx + gw + 6;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = full ? (m.frame % 16 < 8 ? '#ffe14d' : '#ff8a1f') : '#ffd84d';
      ctx.strokeText(spLabel, lx, 90); ctx.fillText(spLabel, lx, 90);
      ctx.restore();
      ctx.fillStyle = '#222'; ctx.font = 'bold 18px sans-serif'; ctx.textBaseline = 'top';
      ctx.textAlign = alignRight ? 'right' : 'left';
      outlined(L(`${label}『${f.weapon.ch}』${f.weapon.strokes}画`, `${label} ${f.weapon.ch} ${f.weapon.strokes} strokes`), alignRight ? x + bw : x, 60);
    };
    const mg = portrait ? 16 : 30;
    bar(mg, m.p, false, m.names[0]);
    bar(W - mg - bw, m.c, true, m.names[1]);
    ctx.fillStyle = '#222'; ctx.font = `bold ${portrait ? 32 : 40}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    outlined(String(Math.max(0, Math.ceil(m.timer / 60))), W / 2, 22);
    // 試合の最初の数秒だけ、必殺ゲージの説明を出す
    if (m.phase === 'fight' && m.fightStart != null && m.frame - m.fightStart < 300) {
      const a = Math.min(1, (300 - (m.frame - m.fightStart)) / 40);
      ctx.save(); ctx.globalAlpha = a;
      const tip = L('黄色い必殺ゲージは、殴られると溜まる', 'The yellow SUPER gauge fills when you take hits');
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(tip).width + 24;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, 104, tw, 26, 13); ctx.fill();
      ctx.fillStyle = '#ffd84d'; ctx.fillText(tip, W / 2, 117);
      ctx.restore();
    }
    if (m.kind === 'survival') {                           // 勝ち抜き：何人目か
      ctx.font = 'bold 16px sans-serif';
      outlined(L(`${(m.stage || 0) + 1}人目${m.boss ? ' ボス' : ''}`, `Opponent #${(m.stage || 0) + 1}${m.boss ? ' BOSS' : ''}`), W / 2, portrait ? 58 : 66, m.boss ? '#c8211a' : null);
    }

    // 縦画面では地面の下に、お互いの武器と効果を表示
    if (portrait) {
      const top = GROUND + 30, area = H - GROUND - 40;
      const sz = Math.min(EN ? 96 : 110, area * (EN ? 0.48 : 0.55));   // 英語は意味の行が増えるので少し小さく
      if (ready(IMG.bg)) {                                          // 背景の絵の上でも文字が読めるように下敷き
        ctx.fillStyle = 'rgba(253,246,227,0.85)';
        ctx.beginPath(); ctx.roundRect(10, GROUND + 14, W - 20, H - GROUND - 22, 14); ctx.fill();
      }
      const card = (cx, f, label) => {
        drawWeaponGlyph(f.weapon, cx, top + sz * 0.5, sz, 0);
        ctx.fillStyle = '#4a3416'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(L(`${label}  ${f.weapon.strokes}画`, `${label}  ${f.weapon.strokes} strokes`), cx, top + sz * 1.4);
        // 英語版は字の意味も出す（例：“cat”）
        const mean = EN ? meaningOf(f.weapon.ch) : '';
        if (mean) { ctx.font = 'italic bold 14px sans-serif'; ctx.fillStyle = '#8a1c14'; ctx.fillText(`“${mean}”`, cx, top + sz * 1.4 + 22, W / 2 - 20); ctx.fillStyle = '#4a3416'; }
        ctx.font = EN ? '13px sans-serif' : '14px sans-serif';
        wrapText(f.weapon.effect || f.weapon.effectText !== L('なし', 'None') ? f.weapon.effectText : L('特殊効果なし', 'No special effect'), cx, top + sz * 1.4 + (mean ? 42 : 26), W / 2 - 30, EN ? 16 : 18);
      };
      card(W * 0.25, m.p, m.names[0]); card(W * 0.75, m.c, m.names[1]);
      Texture.draw(ctx, 'VS', W / 2, top + sz * 0.5, 40, 'red');
    }
  }
  function wrapText(str, cx, y, maxW, lh) {
    let line = '';
    // 英語は単語ごと、日本語は1文字ごとに折り返す
    const parts = EN ? str.split(/(?<= )/) : [...str];   // 「（www）」のような英字まじりの日本語も1文字ずつ
    for (const part of parts) {
      if (line && ctx.measureText(line + part).width > maxW) { ctx.fillText(line.trimEnd(), cx, y); line = part.trimStart(); y += lh; }
      else line += part;
    }
    if (line) ctx.fillText(line, cx, y);
  }

  // 画面中央の大きな文字（質感つき）。登場時に少しはねる
  // 試合開始の「炎 VS 鬼」：漢字は武器と同じ読みやすい書体で、VS だけ見出しの書体で別々に描く
  function drawVsBanner(m, t) {
    const pop = 1 + 0.35 * Math.max(0, 1 - t / 12) * Math.cos(t / 2), y = Math.max(130, GROUND * 0.3);
    const ks = Math.min(130, W * 0.26);
    drawWeaponGlyphAt(m.p.weapon, W * 0.22, y, ks * pop);
    Texture.draw(ctx, 'VS', W / 2, y, Math.round(ks * 0.55), 'red', 0, pop);
    drawWeaponGlyphAt(m.c.weapon, W * 0.78, y, ks * pop);
  }
  function drawWeaponGlyphAt(w, x, y, size) {
    Texture.draw(ctx, w.ch, x, y, Math.round(size), weaponStyle(w));
  }
  function bigText(str, size, style, t) {
    size = Math.round(Texture.fitSize(str, size, W - 20));
    const pop = t == null ? 1 : 1 + 0.35 * Math.max(0, 1 - t / 12) * Math.cos(t / 2);
    Texture.draw(ctx, str, W / 2, GROUND * 0.42, size, style, 0, pop);
  }

  // ---------- 必殺技のカットイン ----------
  // 画面が暗くなり、斜めの帯が横から飛び込んで、字のアップと技名がドーンと出る
  // 技名を2行に分ける位置（半分で切ると言葉が切れてしまう名前だけ。数字は1行目の文字数）
  const JA_BREAK = { '無限寿司地獄': 2, '無限蟻地獄': 2, '超重力崩壊': 3, '超巨大化': 1 };
  function drawCutin(c) {
    const t = c.t, f = c.f, dir = f.side === 0 ? 1 : -1;
    const inK = Math.min(1, t / 9), outK = Math.max(0, (t - (CUT_LEN - 9)) / 9);
    const ease = 1 - Math.pow(1 - inK, 3);
    ctx.save();
    ctx.fillStyle = `rgba(10,5,0,${0.6 * ease * (1 - outK)})`; ctx.fillRect(0, 0, W, H);
    const cy = Math.max(190, GROUND * 0.46), bh = portrait ? 230 : 200;
    ctx.translate(-dir * (1 - ease) * W * 1.3 + dir * outK * W * 1.3, 0);
    // 帯（少し傾ける）
    ctx.save(); ctx.translate(W / 2, cy); ctx.rotate(-0.08 * dir);
    const g = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    const cols = f.side === 0 ? ['#ff8a3a', '#c8211a', '#6a0a05'] : ['#6ab0ff', '#1f4fc8', '#0a1a5a'];
    g.addColorStop(0, cols[0]); g.addColorStop(0.5, cols[1]); g.addColorStop(1, cols[2]);
    ctx.fillStyle = g; ctx.fillRect(-W, -bh / 2, W * 2, bh);
    ctx.fillStyle = '#ffd84d'; ctx.fillRect(-W, -bh / 2 - 6, W * 2, 6); ctx.fillRect(-W, bh / 2, W * 2, 6);
    // 帯の中を流れる線
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const y = -bh / 2 + 8 + ((i * 53) % (bh - 16)), len = 60 + (i % 4) * 40;
      const x = (((t * 38 + i * 131) % (W * 2)) - W) * -dir;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * dir, y); ctx.stroke();
    }
    ctx.restore();
    // 字のアップ（はねて登場）
    const pop = 1 + 0.4 * Math.max(0, 1 - (t - 5) / 10) * (t > 5 ? 1 : 0);
    const kx = dir > 0 ? W * 0.25 : W * 0.75;
    Texture.draw(ctx, f.weapon.ch, kx, cy - 4, Math.round(bh * 0.82), weaponStyle(f.weapon), 0, pop);
    // 「必殺技!!」と技名
    const nx = dir > 0 ? W * 0.66 : W * 0.34, maxW = W * 0.6;
    Texture.draw(ctx, L('必殺技!!', 'SUPER MOVE!!'), nx, cy - bh * 0.3, 26, 'silver');
    if (t > 12) {
      const name = c.sup.name, k = Math.min(1, (t - 12) / 6), s = 1 + (1 - k) * 0.8;
      // 長い技名は2行に分ける（英語は単語で、漢字の技名は4文字以上なら 2+2・2+3 で）
      const words = name.split(' '), chars = [...name];
      const lines = name.length > 11 && words.length > 1
        ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
        : !EN && chars.length >= 4 ? [chars.slice(0, JA_BREAK[name] || chars.length >> 1).join(''), chars.slice(JA_BREAK[name] || chars.length >> 1).join('')] : [name];
      const jaTwo = !EN && lines.length > 1, gap = jaTwo ? 64 : 50;
      lines.forEach((ln, i) => {
        const size = Math.round(Texture.fitSize(ln, jaTwo ? 62 : lines.length > 1 ? 44 : 60, maxW));
        // 漢字の2行目は少し右にずらして、勢いを出す
        const sx = jaTwo ? (i === 0 ? -18 : 18) * dir : 0;
        Texture.draw(ctx, ln, nx + sx, cy + 14 + (i - (lines.length - 1) / 2) * gap, size, 'name', -0.04 * dir, s);
      });
    }
    ctx.restore();
  }
  // ---------- 必殺技：力をためる・技名 ----------
  // カットインのあと、まわりが暗くなり、技を出す字が光って力をためる
  function drawCharge(ch) {
    const f = ch.c.f, k = Math.min(1, ch.t / 10);
    ctx.save();
    ctx.fillStyle = `rgba(10,5,0,${0.5 * k})`; ctx.fillRect(cam.x - W, -H, W * 2 / cam.z + W, H * 3);
    const cx = f.x, cy = f.y - 90, r = 60 + ch.t * 2.5;
    const col = f.side === 0 ? '255,150,40' : '90,170,255';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${col},0.75)`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 4;                       // 縮んでいく光の輪
    for (const o of [0, 15, 30]) { const rr = 200 - ((ch.t * 4 + o * 4) % 180); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  // 技が出ている間、画面の上に技名を出しておく（何の技か分かるように）
  function drawSuperName(m) {
    const left = m.superSlow, k = Math.min(1, (SLOW_LEN - left) / 10, left / 15);
    const y = 140, name = m.superName.name;
    ctx.save(); ctx.globalAlpha = k;
    ctx.fillStyle = m.superName.side === 0 ? 'rgba(160,20,10,0.75)' : 'rgba(20,50,160,0.75)';
    ctx.fillRect(0, y - 30, W, 60);
    Texture.draw(ctx, name, W / 2, y, Math.round(Texture.fitSize(name, 44, W - 40)), 'name');
    ctx.restore();
  }
  // ---------- KO の瞬間 ----------
  // 止まった画面に集中線、上下に黒い帯（映画のように）、そのあと「○○でKO!」
  function drawKo(m) {
    const t = m.phaseT, focus = !!m.koFocus;
    if (focus) {
      const bar = Math.min(1, t / 12) * (portrait ? 40 : 30) * (t > 170 ? Math.max(0, 1 - (t - 170) / 20) : 1);
      const top = 100, bottom = portrait ? GROUND + 12 : H;     // HPバーの下から、説明欄の上まで
      ctx.fillStyle = '#000'; ctx.fillRect(0, top, W, bar); ctx.fillRect(0, bottom - bar, W, bar);
      if (t < 40) {                                          // 集中線
        const cx = W / 2, cy = GROUND * 0.55;
        ctx.save(); ctx.globalAlpha = t < 24 ? 0.8 : 0.8 * (1 - (t - 24) / 16);
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 48; i++) {
          const a = i / 48 * TAU + (i % 3) * 0.02, r0 = 170 + ((i * 47) % 90), r1 = Math.max(W, H);
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a + 0.015) * r1, cy + Math.sin(a + 0.015) * r1);
          ctx.lineTo(cx + Math.cos(a - 0.015) * r1, cy + Math.sin(a - 0.015) * r1); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
    const delay = focus ? 24 : 0;
    if (t < delay) return;
    if (m.koBy) {                                            // 字は大きく単独で、「でKO!」は横に（画数の多い字も潰れないように）
      const tt = t - delay, pop = 1 + 0.35 * Math.max(0, 1 - tt / 12) * Math.cos(tt / 2), y = GROUND * 0.42;
      Texture.draw(ctx, m.koBy, W * 0.28, y, 180, Weapon.isSpecial(m.koBy) ? 'red' : 'silver', -0.05, pop);
      Texture.draw(ctx, L('でKO!', 'KO!'), W * 0.71, y + 12, Math.round(Texture.fitSize(L('でKO!', 'KO!'), 96, W * 0.46)), 'red', 0, pop);
    } else bigText(m.banner, 104, 'red', t - delay);
  }

  // ---------- カメラ（寄り・引き）----------
  // 2人が近いと寄って大きく、離れると引いて2人とも映す。高く跳んだときは寄りを弱めて上まで映す
  const cam = { x: 480, z: 1 };
  // 体（倒れていれば横向き）と、持っている漢字が入る範囲
  function fighterBounds(f) {
    const g = f.weaponGeom(), s = f.weapon.size * 0.6;
    let l = f.x - 55, r = f.x + 55, t = f.y - 185;
    if (f.down > 0) {                                  // 倒れると、頭が向きと反対側へ寝る
      if (f.facing > 0) { l = f.x - 200; r = f.x + 60; } else { l = f.x - 60; r = f.x + 200; }
      t = f.y - 90;
    }
    return { l: Math.min(l, g.cx - s), r: Math.max(r, g.cx + s), t: Math.min(t, g.cy - s) };
  }
  // 背景の絵が画面の左右からはみ出している幅（そこまでは寄っても絵が切れない）
  function bgSpare() {
    const b = bgFit();
    return b ? Math.max(0, (b.w - W) / 2) : 0;
  }
  // 範囲（left〜right、上は top）が必ず画面に収まる分だけ寄る
  function frameOn(left, right, top, maxZ, pad) {
    let z = Math.min(maxZ, W / (right - left + pad * 2));
    if (top < GROUND) z = Math.min(z, (GROUND - 100) / (GROUND - top));   // HPバー（上から100px）の下に収める
    z = Math.max(1, z);
    const half = W / (2 * z), spare = bgSpare();
    const x = Math.max(half - spare, Math.min(W - half + spare, (left + right) / 2));
    return { x, z };
  }
  function cameraTarget(m) {
    // KOの瞬間は倒れた側に寄る。ただし倒れた体と字が全部映る倍率まで
    if (m.phase === 'ko' && m.koLoser && m.phaseT < 150) {
      const b = fighterBounds(m.koLoser);
      return frameOn(b.l, b.r, b.t, portrait ? 1.6 : 1.45, 24);
    }
    // ふだんは、2人の体と持っている漢字がすべて入る範囲
    let left = Infinity, right = -Infinity, top = Infinity;
    for (const f of [m.p, m.c]) {
      const b = fighterBounds(f);
      left = Math.min(left, b.l); right = Math.max(right, b.r); top = Math.min(top, b.t);
    }
    return frameOn(left, right, top, portrait ? 1.2 : 1.1, 30);
  }
  function updateCamera(m, snap) {
    const t = cameraTarget(m);
    if (snap) { cam.x = t.x; cam.z = t.z; return; }
    const ko = m.phase === 'ko' && m.koLoser;                  // KOのアップは素早く寄る
    cam.z += (t.z - cam.z) * (ko ? 0.14 : 0.07);
    cam.x += (t.x - cam.x) * (ko ? 0.2 : 0.12);
    // ゆっくり追いかけている間も、2人の体だけは必ず画面に入れる（瞬間移動やダッシュのあと）
    if (!ko) {
      const l = Math.min(m.p.x, m.c.x) - 50, r = Math.max(m.p.x, m.c.x) + 50;
      cam.z = Math.max(1, Math.min(cam.z, W / (r - l)));
      const hh = W / (2 * cam.z);
      cam.x = Math.max(r - hh, Math.min(l + hh, cam.x));
    }
    const half = W / (2 * cam.z), spare = bgSpare();
    cam.x = Math.max(half - spare, Math.min(W - half + spare, cam.x));   // 背景の絵の外が映らないように
  }

  // セリフや効果の文字（「アチチ!」「ダウン!」など）：カメラで寄っても大きさは変えず、画面の内側に収める
  function drawTexts() {
    const topLimit = 100;                                         // HPバーと名前の下から
    const bottomLimit = portrait ? GROUND - 6 : H - 10;           // 縦画面は下の情報欄にかからないように
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const t of texts) {
      let sx = (t.x - cam.x) * cam.z + W / 2, sy = (t.y - GROUND) * cam.z + GROUND;
      ctx.font = `bold ${t.size}px sans-serif`;
      const hw = ctx.measureText(t.str).width / 2 + 6, hh = t.size / 2 + 4;
      sx = Math.max(hw, Math.min(W - hw, sx));
      sy = Math.max(topLimit + hh, Math.min(bottomLimit - hh, sy));
      ctx.globalAlpha = Math.min(1, t.life / 15);
      ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.strokeText(t.str, sx, sy);
      ctx.fillStyle = t.color; ctx.fillText(t.str, sx, sy);
    }
    ctx.restore();
  }

  // 音のボタン：縦画面の対戦中は、画面右下だと相手の字の説明文に重なるので、
  // 上のHPバーと必殺技名の帯より下の、右はしの空いている所へ移す。それ以外は CSS のとおり右下
  let soundBtnSpot = '';
  function placeSoundBtn() {
    const btn = $('btn-sound');
    if (!btn) return;
    const inBattle = portrait && match && !document.querySelector('.screen:not(.hidden)');
    if (!inBattle) {
      if (soundBtnSpot) { btn.style.top = btn.style.right = btn.style.bottom = ''; soundBtnSpot = ''; }
      return;
    }
    const r = canvas.getBoundingClientRect(), s = Math.min(r.width / W, r.height / H);   // 画面に収めた（object-fit: contain）キャンバスの位置
    const ox = r.left + (r.width - W * s) / 2, oy = r.top + (r.height - H * s) / 2;
    const top = Math.round(oy + 182 * s), right = Math.round(window.innerWidth - (ox + (W - 12) * s));
    const spot = top + ',' + right;
    if (spot === soundBtnSpot) return;
    soundBtnSpot = spot;
    btn.style.top = top + 'px'; btn.style.right = right + 'px'; btn.style.bottom = 'auto';
  }
  function render() {
    placeSoundBtn();
    ctx.save();
    if (match && shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    // カメラ：地面の高さは画面上で固定したまま、2人の真ん中に寄ったり引いたりする
    if (match) { const z = cam.z * (1 + punch); ctx.translate(W / 2, GROUND); ctx.scale(z, z); ctx.translate(-cam.x, -GROUND); }
    drawBg();
    if (match) {
      drawSwamps(); drawCracks(); drawTraps(); drawStinks();
      drawAuraBack(match.c, match.p); drawAuraBack(match.p, match.c);
      if (match.charge) drawCharge(match.charge);
      drawFxs(true);
      drawFighter(match.c); drawFighter(match.p);
      drawStatus(match.c); drawStatus(match.p);
      drawAuraFront(match.c); drawAuraFront(match.p);
      drawProjectiles();
      drawFxs(false);
      for (const pt of particles) {
        ctx.globalAlpha = Math.min(1, pt.life / 20);
        if (pt.coin) {
          ctx.save(); ctx.translate(pt.x, pt.y); ctx.scale(Math.abs(Math.cos(pt.spin)) * 0.85 + 0.15, 1);
          ctx.fillStyle = '#f2c230'; ctx.strokeStyle = '#a87a10'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 7, 9, 0, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, 0, 4, 5.5, 0, 0, TAU); ctx.stroke(); ctx.restore();
        } else if (pt.bill) drawBill(pt.x, pt.y, 30, 14, pt.rot);
        else if (pt.petal) { ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot); ctx.scale(1, Math.abs(Math.cos(pt.rot * 1.7)) * 0.7 + 0.3); ctx.fillStyle = pt.color; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5.5, 0, 0, TAU); ctx.fill(); ctx.restore(); }
        else if (pt.ch) { ctx.fillStyle = pt.color; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pt.ch, pt.x, pt.y); }
        else if (pt.streak) { ctx.fillStyle = pt.color; ctx.fillRect(pt.x, pt.y, 40, 2); }
        else { ctx.fillStyle = pt.color; ctx.fillRect(pt.x, pt.y, pt.r, pt.r); }
      }
      ctx.globalAlpha = 1;
      // 画面全体の効果
      if (match.p.timestop > 0 || match.c.timestop > 0) { ctx.fillStyle = 'rgba(70,70,110,0.18)'; ctx.fillRect(0, 0, W, H); }
      if (match.dark > 0) { ctx.fillStyle = `rgba(0,0,0,${0.72 * Math.min(1, match.dark / 30)})`; ctx.fillRect(0, 0, W, H); }
      if (match.flash > 0) { ctx.fillStyle = `rgba(255,255,240,${match.flash / 25})`; ctx.fillRect(0, 0, W, H); }
      if (match.mono > 0) {                    // 滅：画面が一瞬白黒になる
        ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
    if (match) {
      drawTexts();
      drawHud(match);
      if (match.phase === 'intro') {
        if (match.phaseT < 90) drawVsBanner(match, match.phaseT);
        else bigText('FIGHT!', 110, 'red', match.phaseT - 90);
      }
      if (match.superName && match.superSlow > 0) drawSuperName(match);
      if (match.phase === 'ko') drawKo(match);
      if (match.cutin) drawCutin(match.cutin);
      if (match.koFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${match.koFlash / 10})`; ctx.fillRect(0, 0, W, H); }
    }
  }

  // 固定 60fps で更新
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last); last = now;
    while (acc >= 1000 / 60) { if (match) step(); acc -= 1000 / 60; }
    render();
    requestAnimationFrame(loop);
  }

  // ---------- 画面遷移 ----------
  let lastPlayerCh = null, current = null;
  function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }
  const input = $('kanji-input');
  // ---------- 英語版：字の意味と、英単語から漢字を探す（kanji-meanings.js）----------
  const MEANINGS = new Map();
  for (const line of (window.KANJI_MEANINGS_RAW || '').split('\n')) {
    const ch = [...line][0];
    if (ch) MEANINGS.set(ch, line.slice(ch.length).split(';'));
  }
  // KANJIDIC2 に無いが、ゲームではおなじみの意味を先頭に足す（表示と英単語さがしの両方に効く）
  for (const [ch, word] of [['忍', 'ninja']]) MEANINGS.set(ch, [word, ...(MEANINGS.get(ch) || [])]);
  const meaningOf = (ch) => (MEANINGS.get(ch) || []).slice(0, 2).join(', ');
  function showMeaning(ch) {
    const m = EN ? meaningOf(ch) : '';
    $('st-meaning-row').classList.toggle('hidden', !m);
    $('st-meaning').textContent = m;
  }
  let specialText = null;   // 特別な字の英語の効果説明（効果の言葉でも探せるように）
  function searchWord(q) {
    q = q.trim().toLowerCase().replace(/[^a-z' -]/g, '');
    if (q.length < 2) return [];
    if (!specialText) specialText = new Map(Weapon.SPECIAL_LIST.map((c) => [c, Weapon.make(c).effectText.toLowerCase()]));
    const words = (s) => s.split(/[^a-z']+/);
    // 並び順：1番目の意味がぴったり → どれかの意味がぴったり → 意味の中の単語 → 特別な字の効果説明 → 前方一致
    const tiers = [[], [], [], [], []];
    for (const [ch, ms] of MEANINGS) {
      const low = ms.map((s) => s.toLowerCase());
      if (low[0] === q) tiers[0].push(ch);
      else if (low.includes(q)) tiers[1].push(ch);
      else if (low.some((s) => words(s).includes(q))) tiers[2].push(ch);
      else if (low.some((s) => words(s).some((w) => w.startsWith(q)))) tiers[4].push(ch);
    }
    for (const [ch, t] of specialText) if (words(t).includes(q)) tiers[3].push(ch);
    const specialFirst = (a) => a.filter((c) => Weapon.isSpecial(c)).concat(a.filter((c) => !Weapon.isSpecial(c)));
    return [...new Set(tiers.flatMap(specialFirst))].slice(0, 12);
  }
  // 英字が入っていたら、漢字の候補を出す
  function showWordResults() {
    const box = $('word-results');
    const q = input.value.trim();
    if (!EN || !/[a-z]/i.test(q)) { box.classList.add('hidden'); return false; }
    const hits = searchWord(q);
    box.innerHTML = '';
    box.classList.remove('hidden');
    $('input-error').textContent = q.length < 2 ? '' : hits.length ? 'Tap a kanji:' : `No kanji found for "${q}"`;
    $('input-error').style.color = hits.length ? '#555' : '';
    for (const ch of hits) {
      const b = document.createElement('button');
      b.className = 'chip word-chip';
      const k = document.createElement('b'); k.textContent = ch;
      const s = document.createElement('small'); s.textContent = (MEANINGS.get(ch) || [Weapon.isSpecial(ch) ? 'special' : ''])[0];
      b.append(k, s);
      if (Weapon.isSpecial(ch)) b.classList.add('special');
      b.addEventListener('click', () => pick(ch));
      box.appendChild(b);
    }
    return true;
  }
  if (EN) { input.maxLength = 24; $('input-hint').classList.remove('hidden'); }
  function refreshPreview() {
    if (showWordResults()) {
      $('btn-fight').disabled = true; $('preview').classList.add('hidden'); current = null;
      return;
    }
    const v = Weapon.validate(input.value);
    $('input-error').textContent = v.ok ? '' : v.error; $('input-error').style.color = '';
    $('btn-fight').disabled = !v.ok;
    $('preview').classList.toggle('hidden', !v.ok);
    current = v.ok ? v.ch : null;
    if (!v.ok) return;
    const w = Weapon.make(v.ch);
    drawPreview(w);
    $('st-strokes').textContent = L(w.strokes + '画' + (w.estimated ? '（推定）' : ''), w.strokes + (w.estimated ? ' (estimated)' : ''));
    $('st-power').textContent = w.stars.power;
    $('st-speed').textContent = w.stars.speed;
    $('st-reach').textContent = w.stars.reach;
    $('st-effect').textContent = w.effectText;
    showMeaning(w.ch);
  }
  // 入力画面の見出し・ボタン・挑戦状の帯を、いまの遊び方に合わせる
  function setInputHeading() {
    const versus = mode.kind === 'versus';
    $('input-title').textContent = !versus ? L('武器にする漢字を１文字', 'Pick one kanji as your weapon')
      : mode.step === 1 ? L('1Pの字を１文字（2Pは見ないで）', '1P: pick a kanji (2P, no peeking)') : L('2Pの字を１文字（1Pは見ないで）', '2P: pick a kanji (1P, no peeking)');
    $('btn-fight').textContent = versus && mode.step === 1 ? L('決定して2Pに渡す', 'Lock in & pass to 2P') : L('この字で戦う', 'FIGHT with this kanji');
    // 1回勝負／勝ち抜きの切り替え（CPU戦のときだけ）
    const solo = mode.kind === 'cpu' || mode.kind === 'survival';
    $('mode-switch').classList.toggle('hidden', !solo);
    for (const b of document.querySelectorAll('#mode-switch .seg')) b.setAttribute('aria-pressed', String(b.dataset.kind === mode.kind));
    $('best-record').classList.toggle('hidden', mode.kind !== 'survival');
    $('best-record').textContent = best.wins > 0 ? L(`最高記録：『${best.ch}』で${best.wins}連勝`, `Best: ${best.wins} wins with ${best.ch}`) : L('負けるまで戦い続ける。何連勝できるか', 'Fight until you lose. How many wins can you get?');
  }
  // 2人対戦は、前の人の字が見えないように毎回空にする
  function openInput(clear) {
    showScreen('screen-input');
    shuffleChips();
    updateHint();
    setInputHeading();
    input.value = clear || mode.kind === 'versus' ? '' : lastPlayerCh || '';
    refreshPreview();
    input.focus(); input.select();
  }
  function toTitle() {
    if (mode.kind === 'versus') mode.kind = 'cpu';
    run = null;
    showScreen('screen-title');
    if (window.Bgm) Bgm.play('title');
  }

  function drawPreview(w) {
    const c = $('preview-char'), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    Texture.draw(g, w.ch, c.width / 2, c.height / 2, 220, weaponStyle(w));
  }

  // タイトルロゴを画面のキャンバスに描く
  function drawLogo() {
    const c = $('logo'), g = c.getContext('2d');
    c.width = LOGO_W * 2; c.height = LOGO_H * 2;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, LOGO_W, LOGO_H);
    drawBrand(g, 0, 0, 1);
  }
  // タイトルロゴ「漢字ファイター」：金の筆文字「漢字」＋赤い一閃＋銀の「FIGHTER」
  // （x, y）を左上に、横 520・縦 300 の大きさを scale 倍して描く。結果カードでも使う
  const LOGO_W = 520, LOGO_H = 300;
  const BRUSH = '"Yuji Boku", "Hiragino Mincho ProN", "Yu Mincho", serif';
  const LATIN = 'Anton, "Arial Narrow", Impact, sans-serif';
  function drawBrand(g, x, y, scale) {
    g.save();
    g.translate(x, y); g.scale(scale, scale);
    g.lineJoin = 'round'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const gold = g.createLinearGradient(0, 40, 0, 170);
    for (const [o, col] of [[0, '#fff6c4'], [0.4, '#f0c040'], [0.52, '#9a6a10'], [0.7, '#e6b02e'], [1, '#fff0a8']]) gold.addColorStop(o, col);
    const silver = g.createLinearGradient(0, 205, 0, 268);
    for (const [o, col] of [[0, '#ffffff'], [0.5, '#c9d3de'], [0.56, '#6d7886'], [1, '#eef2f6']]) silver.addColorStop(o, col);
    // 漢字（少し右に傾ける）
    g.save(); g.translate(260, 164); g.transform(1, 0, -0.105, 1, 0, 0);
    g.font = `160px ${BRUSH}`;
    g.lineWidth = 22; g.strokeStyle = '#1a0e05'; g.strokeText('漢字', 0, 0);
    g.lineWidth = 5; g.strokeStyle = '#6a4300'; g.strokeText('漢字', 0, 0);
    g.fillStyle = gold; g.fillText('漢字', 0, 0);
    g.restore();
    // 赤い一閃
    g.fillStyle = '#c8211a';
    g.beginPath(); g.moveTo(30, 196); g.lineTo(496, 180); g.lineTo(494, 190); g.lineTo(28, 206); g.closePath(); g.fill();
    g.fillStyle = '#ff9a6a';
    g.beginPath(); g.moveTo(40, 198); g.lineTo(486, 183); g.lineTo(486, 186); g.lineTo(40, 201); g.closePath(); g.fill();
    // FIGHTER
    g.save(); g.translate(262, 268); g.transform(1, 0, -0.176, 1, 0, 0);
    g.font = `80px ${LATIN}`;
    if ('letterSpacing' in g) g.letterSpacing = '6px';
    g.lineWidth = 14; g.strokeStyle = '#1a0e05'; g.strokeText('FIGHTER', 0, 0);
    g.lineWidth = 4; g.strokeStyle = '#c8211a'; g.strokeText('FIGHTER', 0, 0);
    g.fillStyle = silver; g.fillText('FIGHTER', 0, 0);
    g.restore();
    g.restore();
  }
  // ロゴの書体を読み込んだら描き直す（読み込み前は代わりの書体で描かれる）
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('160px "Yuji Boku"', '漢字'), document.fonts.load('80px Anton', 'FIGHTER')])
      .then(() => { drawLogo(); if (lastResult && !$('screen-result').classList.contains('hidden')) showResult(lastResult); })
      .catch(() => {});
  }
  Texture.onFontChange(() => {
    drawLogo();
    if (current && !$('preview').classList.contains('hidden')) drawPreview(Weapon.make(current));
    if (lastResult && !$('screen-result').classList.contains('hidden')) showResult(lastResult);
    if (!$('screen-dex').classList.contains('hidden')) buildDex();
  });

  let starting = false;
  // rivalCh：相手の字（挑戦状・2人対戦）。無ければCPUがえらぶ
  function launch(playerCh, rivalCh) {
    if (starting) return;
    starting = true;
    const cpuCh = rivalCh || Weapon.randomForCpu();
    Texture.preload(playerCh + cpuCh + L('VSFIGHT!でKO『』時間切れ相打ち', 'VSFIGHT!KOBYTIMEUPDOUBLEZ…')).then(() => {
      starting = false;
      startMatch(playerCh, cpuCh);
    });
  }
  function go() {
    if (!current) return;
    input.blur();
    if (mode.kind === 'versus') {
      if (mode.step === 1) { mode.p1 = current; mode.step = 2; input.value = ''; refreshPreview(); showScreen('screen-pass'); return; }
      mode.p2 = current; mode.step = 1;
      launch(mode.p1, mode.p2);
      return;
    }
    if (mode.kind === 'survival') { startRun(current); return; }
    launch(current);
  }
  function startRun(ch) {
    run = { wins: 0, hp: 100 };
    launch(ch, survivalRival(0));
  }

  // ---------- 漢字図鑑 ----------
  let dexFrom = 'screen-title';
  function openDex(from) {
    dexFrom = from;
    buildDex();
    showScreen('screen-dex');
    $('screen-dex').scrollTop = 0;
  }
  function buildDex() {
    $('dex-count').textContent = L(`発見 ${found.size}／${TOTAL}`, `Found ${found.size}/${TOTAL}`);
    $('dex-seal').textContent = allFound() ? L('隠し字『龘』の封印が解けている', 'The secret kanji 龘 is unsealed') : L(`あと${TOTAL - found.size}字見つけると、隠し字の封印が解ける`, `Find ${TOTAL - found.size} more to unseal the secret kanji`);
    const grid = $('dex-grid');
    grid.innerHTML = '';
    const list = [...Weapon.SPECIAL_LIST];
    if (allFound()) list.push('龘');                                 // 100字そろうと、隠し字のマスが出る
    for (const ch of list) {
      const b = document.createElement('button');
      b.className = 'dex-cell';
      if (inDex(ch)) {
        const c = document.createElement('canvas'), gold = ch === '神' || ch === '龘';
        c.width = c.height = 120;
        Texture.draw(c.getContext('2d'), ch, 60, 60, 74, gold ? 'gold' : 'red');
        if (gold) b.classList.add('divine');
        b.appendChild(c);
        b.setAttribute('aria-label', ch);
      } else {
        b.textContent = '？'; b.classList.add('unknown');
        b.setAttribute('aria-label', L('未発見', 'Not found yet'));
      }
      b.addEventListener('click', () => { sfx('click'); showDexInfo(ch, b); });
      grid.appendChild(b);
    }
    $('dex-info').classList.add('hidden');
  }
  // ---------- 図鑑に登録される演出 ----------
  // 新しく勝った字が、図鑑のマスへ飛んでいって埋まる（あと何字か・次のヒントも出して、ほかの字も探したくなるように）
  // 神・龘は特別版：暗転→後光と光の粒→字が天から降りてくる→白く光って封印が解ける→金のマスにはまる→自慢用のシェア
  const DexReveal = (() => {
    let queue = [], busy = false;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const anim = (el, frames, opt) => (el.animate ? el.animate(frames, opt).finished.catch(() => {}) : Promise.resolve());
    const glyph = (ch, size, style) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      Texture.draw(c.getContext('2d'), ch, size / 2, size / 2, size * 0.62, style);
      return c;
    };
    const isDivine = (ch) => ch === '神' || ch === '龘';
    function fillCell(cell, ch) {
      cell.textContent = ''; cell.classList.remove('unknown');
      if (isDivine(ch)) cell.classList.add('divine');
      cell.appendChild(glyph(ch, 64, isDivine(ch) ? 'gold' : 'red'));
    }
    function build(item) {
      const root = document.createElement('div');
      root.className = 'dexr' + (item.divine ? ' divine' : '');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', L(`漢字図鑑に『${item.ch}』が登録された`, `${item.ch} was added to the Kanjidex`));
      root.innerHTML = '<div class="dexr-fx" aria-hidden="true"></div><div class="dexr-box"><p class="dexr-head"></p><p class="dexr-sub"></p>'
        + '<div class="dexr-stage"></div><div class="dexr-grid"></div><div class="dexr-bar"><i></i></div><p class="dexr-count"></p>'
        + '<p class="dexr-next"></p><div class="dexr-btns"></div></div>';
      // 図鑑のマス（登録する字は、まだ「？」のまま）
      const grid = root.querySelector('.dexr-grid');
      const list = [...Weapon.SPECIAL_LIST];
      if (item.ch === '龘' || allFound()) list.unshift('龘');         // 隠し字のマスは100字そろってから、いちばん上に出る
      let target = null;
      for (const ch of list) {
        const cell = document.createElement('div');
        cell.className = 'dexr-cell' + (ch === '龘' ? ' secret' : '');
        if (ch === item.ch) target = cell;
        if (ch !== item.ch && (found.has(ch) || (ch === '龘' && Weapon.isSpecial('龘')))) fillCell(cell, ch);
        else { cell.textContent = ch === '龘' ? '秘' : '？'; cell.classList.add('unknown'); }
        // 埋まっていないマスをタップすると、その字のヒントを下に出す
        if (ch !== item.ch) cell.addEventListener('click', () => {
          if (!cell.classList.contains('unknown')) return;
          const nx = root.querySelector('.dexr-next');
          for (const el of grid.querySelectorAll('.dexr-cell.on')) el.classList.remove('on');
          cell.classList.add('on');
          nx.textContent = ch === '龘' ? L('特別な漢字100字をすべて見つけると封印が解ける', 'Find all 100 special kanji to unseal it') : L(`ヒント：${hintOf(ch)}`, `Hint: ${hintOf(ch)}`);
          nx.classList.add('show'); sfx('click');
        });
        grid.appendChild(cell);
      }
      return { root, target };
    }
    // 光の粒をはじけさせる
    function burst(layer, x, y, n, color, dist) {
      for (let i = 0; i < n; i++) {
        const s = document.createElement('i'); s.className = 'dexr-spark'; s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.background = color;
        layer.appendChild(s);
        const a = Math.random() * Math.PI * 2, d = dist * (0.4 + Math.random() * 0.8);
        anim(s, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0.2)`, opacity: 0 }],
          { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).then(() => s.remove());
      }
    }
    async function show(item) {
      const { root, target } = build(item);
      const box = root.querySelector('.dexr-box'), stage = root.querySelector('.dexr-stage'), fx = root.querySelector('.dexr-fx');
      const head = root.querySelector('.dexr-head'), sub = root.querySelector('.dexr-sub'), btns = root.querySelector('.dexr-btns');
      const total = TOTAL, before = Math.max(0, (item.count || found.size) - 1);
      const count = root.querySelector('.dexr-count'), bar = root.querySelector('.dexr-bar i'), next = root.querySelector('.dexr-next');
      const setCount = (n) => { count.textContent = L(`発見 ${n} ／ ${total}`, `Found ${n} / ${total}`); bar.style.width = (n / total * 100) + '%'; };
      setCount(item.ch === '龘' ? total : before);
      $('wrap').appendChild(root);
      let skip = false;
      root.addEventListener('click', (e) => { if (!e.target.closest('.dexr-btns')) skip = true; });
      const pause = async (ms) => { for (let t = 0; t < ms && !skip; t += 50) await wait(50); };
      const big = glyph(item.ch, 360, item.divine ? 'gold' : 'red'); big.className = 'dexr-big';
      stage.appendChild(big);
      if (item.divine) {
        // ---- 神・龘：封印解放 ----
        head.textContent = L('封印解放', 'SEAL BROKEN');
        sub.textContent = item.ch === '神'
          ? L(`勝ち抜き${item.wins || 10}連勝。漢字ファイターの神にだけ許された字`, `${item.wins || 10} wins in a row. The kanji only a Kanji Fighter God may wield`)
          : L('特別な漢字100字をすべて見つけた者だけが使える、伝説の漢字', 'The legendary kanji, for those who found all 100 special kanji');
        root.classList.add('dark');
        sfx('cutin');
        await anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' });
        await pause(600);
        root.classList.add('rays');                                   // 後光が差す
        sfx('gauge');
        anim(big, [{ transform: 'translateY(-70vh) scale(0.6)', opacity: 0, filter: 'brightness(3) blur(6px)' },
          { transform: 'translateY(-8vh) scale(1.05)', opacity: 1, filter: 'brightness(1.6) blur(0)', offset: 0.75 },
          { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'brightness(1)' }], { duration: skip ? 300 : 2600, easing: 'cubic-bezier(.15,.7,.25,1)', fill: 'forwards' });
        await pause(2600);
        // 封印が砕ける：白い閃光と光の粒
        sfx('unlock'); sfx('superhit');
        const r = big.getBoundingClientRect();
        burst(fx, r.left + r.width / 2, r.top + r.height / 2, 60, '#fff3b0', 260);
        burst(fx, r.left + r.width / 2, r.top + r.height / 2, 30, '#ffffff', 180);
        const flash = document.createElement('div'); flash.className = 'dexr-flash'; root.appendChild(flash);
        anim(flash, [{ opacity: 0.95 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' }).then(() => flash.remove());
        head.classList.add('show'); sub.classList.add('show');
        big.classList.add('glow');
        await pause(2200);
      } else {
        head.textContent = L('漢字図鑑に登録！', 'Added to the Kanjidex!');
        sub.textContent = L(`『${item.ch}』で勝った！`, `You won with ${item.ch}!`);
        head.classList.add('show'); sub.classList.add('show');
        await anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
        sfx('proc');
        await anim(big, [{ transform: 'scale(0.2) rotate(-20deg)', opacity: 0 }, { transform: 'scale(1.15) rotate(4deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: skip ? 150 : 550, easing: 'ease-out', fill: 'forwards' });
        await pause(700);
      }
      // 図鑑のマスへ飛んでいく
      root.classList.add('grid-on');
      await wait(50);
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        const a = big.getBoundingClientRect(), b = target.getBoundingClientRect();
        const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), s = b.width / a.width;
        await anim(big, [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
          { duration: skip ? 200 : item.divine ? 900 : 600, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
        big.style.visibility = 'hidden';
        fillCell(target, item.ch);
        target.classList.add('stamp');
        burst(fx, b.left + b.width / 2, b.top + b.height / 2, item.divine ? 40 : 16, item.divine ? '#ffe680' : '#ffd84d', item.divine ? 160 : 70);
        sfx(item.divine ? 'unlock' : 'hit', 10, 60);
      }
      // 数が増える
      const after = item.ch === '龘' ? total : (item.count || found.size);
      setCount(after);
      count.classList.add('bump');
      // 次の目標
      const left = total - found.size;
      if (item.ch === '神') next.textContent = L('『神』が本当の力で使えるようになった', 'You can now use the true power of 神');
      else if (item.ch === '龘') next.textContent = L('『龘』が使えるようになった。図鑑、完成！', 'You can now use 龘. Kanjidex complete!');
      else if (left > 0) {
        // 次のヒントは出さない（？のマスをタップすると、その字のヒントが見られる）
        next.textContent = L(`あと${left}字。${allFound() ? '' : '100字そろうと隠し字の封印が解ける。'}「？」をタップするとヒントが見られる`,
          `${left} to go. Tap a "?" to see its hint`);
      } else next.textContent = L('100字すべて見つけた！', 'All 100 found!');
      next.classList.add('show');
      // ボタン（神・龘は自慢用のシェアも）
      if (item.divine) {
        const a = document.createElement('a'); a.className = 'btn btn-x'; a.target = '_blank'; a.rel = 'noopener';
        const text = item.ch === '神'
          ? L(`漢字ファイターで勝ち抜き${item.wins || 10}連勝！『神』の封印を解いて「漢字ファイターの神」になった`, `${item.wins || 10} wins in a row in Kanji Fighter! I broke the seal on 神 and became a Kanji Fighter God`)
          : L('漢字ファイターで特別な漢字100字をすべて見つけて、隠し字『龘』の封印を解いた！', 'I found all 100 special kanji in Kanji Fighter and broke the seal on the secret kanji 龘!');
        a.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text + '\n' + L('#漢字ファイター', '#KanjiFighter') + '\n' + GAME_URL);
        a.textContent = L('𝕏 で自慢する', 'Brag on 𝕏');
        btns.appendChild(a);
      }
      const ok = document.createElement('button'); ok.className = 'btn' + (item.divine ? ' btn-sub' : ''); ok.textContent = L('閉じる', 'Close');
      btns.appendChild(ok);
      btns.classList.add('show');
      await new Promise((r) => ok.addEventListener('click', () => { sfx('click'); r(); }, { once: true }));
      await anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
      root.remove();
    }
    async function run() {
      if (busy) return;
      busy = true;
      while (queue.length) { try { await show(queue.shift()); } catch (e) { console.warn(e); document.querySelectorAll('.dexr').forEach((el) => el.remove()); } }
      busy = false;
    }
    return { play(items) { queue.push(...items); run(); } };
  })();
  function showDexInfo(ch, cell) {
    for (const el of document.querySelectorAll('.dex-cell.on')) el.classList.remove('on');
    cell.classList.add('on');
    const box = $('dex-info'), c = $('dex-char'), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    if (inDex(ch)) {
      const w = Weapon.make(ch), e = dex[ch] || {};
      Texture.draw(g, ch, c.width / 2, c.height / 2, 120, ch === '神' || ch === '龘' ? 'gold' : 'red');
      $('dex-name').textContent = L(`『${ch}』 ${w.strokes}画`, `${ch}  ${w.strokes} strokes` + (meaningOf(ch) ? ` · ${meaningOf(ch)}` : ''));
      $('dex-text').textContent = w.effectText;
      $('dex-meta').textContent = L(`初めて使った日：${showDate(e.first) || '記録なし'}\nこの字での勝ち：${e.wins || 0}回`, `First used: ${showDate(e.first) || 'no record'}\nWins with it: ${e.wins || 0}`);
    } else {
      Texture.draw(g, '？', c.width / 2, c.height / 2, 110, 'silver');
      $('dex-name').textContent = L('まだ見つけていない字', 'Not found yet');
      $('dex-text').textContent = L(`ヒント：${hintOf(ch)}`, `Hint: ${hintOf(ch)}`);
      $('dex-meta').textContent = L('その字で勝つと図鑑に登録される', 'Win with it to add it to the Kanjidex');
    }
    box.classList.remove('hidden');
  }
  input.addEventListener('input', refreshPreview);
  input.addEventListener('compositionend', refreshPreview);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) go(); });
  $('btn-start').addEventListener('click', () => { sfx('click'); openInput(); });
  $('btn-versus').addEventListener('click', () => { sfx('click'); mode.kind = 'versus'; mode.step = 1; openInput(true); });
  $('btn-pass').addEventListener('click', () => { sfx('click'); openInput(true); });
  $('btn-fight').addEventListener('click', () => { sfx('click'); go(); });
  $('btn-again').addEventListener('click', () => {
    sfx('click');
    if (mode.kind === 'versus') launch(mode.p1, mode.p2);
    else if (mode.kind === 'survival') startRun(lastPlayerCh);
    else launch(lastPlayerCh);
  });
  for (const b of document.querySelectorAll('#mode-switch .seg')) b.addEventListener('click', () => {
    sfx('click'); mode.kind = b.dataset.kind; setInputHeading();
  });
  $('btn-next').addEventListener('click', () => { sfx('click'); if (run) launch(lastPlayerCh, survivalRival(run.wins)); });
  $('btn-quit').addEventListener('click', () => { sfx('click'); if (run && runMatch) endWith(runMatch, null, true); });
  $('btn-dex').addEventListener('click', () => { sfx('click'); openDex('screen-title'); });
  $('found-hint').addEventListener('click', () => { sfx('click'); openDex('screen-input'); });
  $('btn-result-dex').addEventListener('click', () => { sfx('click'); openDex('screen-result'); });
  $('btn-dex-back').addEventListener('click', () => { sfx('click'); showScreen(dexFrom); });
  $('btn-credits').addEventListener('click', () => { sfx('click'); showScreen('screen-credits'); $('screen-credits').scrollTop = 0; });
  $('btn-credits-back').addEventListener('click', () => { sfx('click'); showScreen('screen-title'); });
  $('btn-change').addEventListener('click', () => { sfx('click'); mode.step = 1; openInput(); });
  $('btn-title').addEventListener('click', () => { sfx('click'); toTitle(); });
  $('btn-input-back').addEventListener('click', () => { sfx('click'); toTitle(); });
  // 言語の切り替え（読み込み直す）
  $('btn-lang').textContent = EN ? '日本語' : 'English';
  $('btn-lang').addEventListener('click', () => { sfx('click'); I18N.setLang(EN ? 'ja' : 'en'); });

  // 結果を画像で保存
  //  1) claude.ai のアーティファクトでは「downloads」機能で保存の確認を出す（スマホでも保存できる）
  //  2) index.html を直接開いたときは、ふつうにダウンロード
  //  3) どちらもできないときは、画像を大きく表示して長押しで保存してもらう
  const SAVE_NAME = L('漢字ファイター_結果.png', 'kanji-fighter-result.png');
  const downloadsReady = (window.claude && typeof window.claude.use === 'function')
    ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  const cardBlob = () => new Promise((res) => (lastCardCanvas ? lastCardCanvas.toBlob(res, 'image/png') : res(null)));
  function showSaveOverlay() {
    $('save-img').src = $('result-card').src;
    $('save-overlay').classList.remove('hidden');
  }
  $('btn-save').addEventListener('click', async () => {
    sfx('click');
    if (!$('result-card').src) return;
    const downloads = await downloadsReady;
    if (downloads) {
      const blob = await cardBlob();
      if (blob) {
        try { await downloads.save({ filename: SAVE_NAME, data: blob }); return; }
        catch (e) { if (e && (e.code === 'declined' || e.code === 'rate_limited')) return; }   // やめた・連打のときは何もしない
      }
      showSaveOverlay(); return;
    }
    let inFrame = true;
    try { inFrame = window.top !== window; } catch (e) {}
    if (!inFrame) {
      const a = document.createElement('a');
      a.href = $('result-card').src; a.download = SAVE_NAME;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    showSaveOverlay();
  });
  $('btn-save-close').addEventListener('click', () => { sfx('click'); $('save-overlay').classList.add('hidden'); });
  $('save-overlay').addEventListener('click', (e) => { if (e.target.id === 'save-overlay') $('save-overlay').classList.add('hidden'); });

  // おすすめ・ランダム（字を入れるだけ。戦うボタンは自分で押す）
  function pick(ch) {
    input.value = ch; refreshPreview(); sfx('click');
    const c = $('preview-char');
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }
  for (const b of document.querySelectorAll('.chip[data-ch]')) b.addEventListener('click', () => pick(b.dataset.ch));
  // ランダム：特別な字は10%、ふつうの字は90%
  const RANDOM_POOL = [...'鬱麺鍋豆腹髪魔謎鬼山川木金石糸虫貝竹米肉骨歯傘箱扉塔城門橋鼻耳目口手足心頭顔鳥魚馬牛羊象亀蛇蟹鯖鰻薔薇檸檬鬼一二三乙丸缶串凸凹卍'].filter((c) => !Weapon.isSpecial(c));
  const pickFrom = (list) => list[Math.floor(Math.random() * list.length)];
  // 「迷ったら」の5字は、入力画面を開くたびに入れ替える：特別な字1つ（まだ見つけていない字を優先）＋ふつうの字4つ
  function shuffleChips() {
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const open = Weapon.SPECIAL_LIST.filter((c) => Weapon.isSpecial(c));      // 封印中の字は出さない
    const unseen = shuffle(open.filter((c) => !found.has(c))), seen = shuffle(open.filter((c) => found.has(c)));
    const picks = shuffle([unseen[0] || seen[0], ...shuffle([...RANDOM_POOL]).slice(0, 4)]);
    document.querySelectorAll('.chip[data-ch]').forEach((b, i) => { if (picks[i]) { b.dataset.ch = picks[i]; b.textContent = picks[i]; } });
  }
  $('btn-random').addEventListener('click', () => {
    let ch;
    do ch = Math.random() < 0.1 ? pickFrom(Weapon.SPECIAL_LIST.filter((c) => Weapon.isSpecial(c))) : pickFrom(RANDOM_POOL);
    while (ch === current);
    pick(ch);
  });

  // 音のオン・オフ（スマホは最初のタップで音が出せるようになる）
  const soundBtn = $('btn-sound');
  const showSound = () => {
    const off = window.Sfx ? Sfx.muted : true;
    soundBtn.textContent = off ? '🔇' : '🔊';
    soundBtn.setAttribute('aria-label', off ? L('音を出す', 'Sound on') : L('音を消す', 'Sound off'));
  };
  soundBtn.addEventListener('click', () => {
    if (!window.Sfx) return;
    Sfx.setMuted(!Sfx.muted); Sfx.unlock(); showSound(); sfx('click');
  });
  showSound();
  window.addEventListener('pointerdown', () => { if (window.Sfx) Sfx.unlock(); }, { once: true });

  if (DEBUG) window.__kf = { get match() { return match; }, step, render, startMatch, get projectiles() { return projectiles; }, get traps() { return traps; }, cam, fighterBounds, setMode: (k) => { mode.kind = k; }, get run() { return run; }, startRun, survivalRival, hintOf, glyphHitsBody, glyphShape, clearOfBody, SURV, DexReveal, startSuper, get smites() { return smites; } };

  layout();
  requestAnimationFrame(loop);
  drawLogo();
  // 起動時は「タップしてスタート」。スマホはタップするまで音を出せないので、ここで音を有効にしてタイトルの曲を流す
  $('tap-start').addEventListener('click', () => {
    if (window.Sfx) Sfx.unlock();
    if (window.Bgm) Bgm.play('title');
    sfx('fight');
    $('screen-title').classList.remove('waiting');
    // 見本（開発用）：?debug#reveal-demo のときだけ、神と龘の封印解放の演出を流す（図鑑の記録や封印は変えない）
    if (DEBUG && location.hash === '#reveal-demo') setTimeout(() => DexReveal.play([{ ch: '神', count: found.size, divine: true, wins: 10 }, { ch: '龘', divine: true }]), 600);
  });
  Texture.preload(L('漢字ファイター連勝0123456789!!勝利敗北…引き分けの1P2P', 'KANJIFGHTERVSWINLOSDAYCT#!…0123456789'));
  // フォントがあとから届いたら、結果の見出しを描き直す（字ごとにフォントが混ざらないように）
  Texture.onFontChange(() => { if (lastResult && !$('screen-result').classList.contains('hidden')) drawResultTitle(lastResult); });
})();
