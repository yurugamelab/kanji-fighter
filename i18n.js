// 日本語／英語の切り替え。
// 言語は「この端末で選んだ言語」→ 無ければ端末の言語（日本語以外なら英語）で決まる。
// 切り替えたらページを読み込み直す（画面ごとに描き直すより確実なので）。
//   I18N.L(日本語, 英語) … いまの言語のほうを返す（文の組み立てに使う）
//   I18N.T(日本語)       … 下の表に英語があれば英語にする（擬音・決まった言葉に使う）
//   HTMLの data-en / data-en-aria / data-en-placeholder は英語のときに差し替える
(function () {
  const KEY = 'kanji-fighter-lang';
  let lang = null;
  try { lang = localStorage.getItem(KEY); } catch (e) {}
  if (lang !== 'ja' && lang !== 'en') lang = /^ja\b/i.test(navigator.language || 'ja') ? 'ja' : 'en';
  const en = lang === 'en';

  // 擬音・技の名前・決まった言葉
  const EN = {
    // 技
    '対空!': 'ANTI-AIR!', 'フルスイング!': 'FULL SWING!', '横薙ぎ!': 'SWEEP!', '突き!': 'STAB!', '叩きつけ!': 'SLAM!',
    '急降下!': 'DIVE BOMB!', '居合!': 'QUICKDRAW!', 'ズルズル!': 'SLUUURP!', 'ビヨーン!': 'BOING!',
    // キャラの状態
    'ヒック': 'hic', 'よいしょ': 'oof', 'ワハハ': 'HAHA', 'くさっ!': 'STINKY!', 'ニャー': 'MEOW', 'ドサッ': 'THUD',
    'スカッ': 'MISS', '蘇った!': 'REVIVED!', 'ヒュン': 'FWIP', 'ゴォー': 'FWOOSH', 'ドーン': 'BOOM', 'ゴォォォー!!': 'FWOOOOSH!!',
    'バババン': 'BANG BANG BANG', 'シュッ': 'SHING', 'シュルル': 'WHIRR', 'えいっ♡': 'TAKE THIS♡', 'パッ': 'POOF', 'キラン': 'TING',
    '無の境地': 'ZEN MODE', 'プゥ〜': 'PFFFT~', 'モー!': 'MOO!', 'ゴゴゴゴ…': 'RUMBLE…', 'ザブーン': 'SPLASH', 'バサッ': 'FLAP',
    'スッ…': 'fade…', 'アオーン!': 'AWOOOO!', '推せる!!': 'STAN!!', 'ズブズブ': 'GLORP', 'ワーッ!!': 'WAAAH!!', 'ビクッ': 'EEK',
    'ポイッ': 'TOSS', 'ガシャン': 'CLANK', '無効': 'NULLIFIED', 'ドロン（分身）': 'POOF (DECOY)', 'キラン（反射）': 'TING (REFLECT)',
    'ガード': 'GUARD', 'ハッ!': 'HUH!', 'ダウン!': 'DOWN!', '魔法!': 'MAGIC!',
    // 当たったときの効果
    'アチチ!': 'HOT HOT!', 'ビリビリ': 'BZZZT', 'カチーン': 'FROZEN', 'ゴオオッ!!': 'WHOOOSH!!', 'ズドン': 'KA-THOOM',
    'ドカーン!!': 'KABOOM!!', 'ガブッ': 'CHOMP', 'ワン!': 'WOOF!', '天罰': 'SMITE', 'ジワジワ…': 'toxic…', 'ワハハ!': 'HAHAHA!',
    'ドキッ': 'BA-DUMP', 'カチッ': 'TICK', 'からっ!': 'SPICY!', 'ムキー!': 'GRRR!', 'ゴン': 'BONK', 'ズバッ!': 'CRIT!',
    'ビュオー': 'WHOOSH', 'シャッ': 'SWISH', 'グサッ': 'THUNK', 'ピカッ': 'FLASH', 'まっくら': 'PITCH BLACK',
    'ザン': 'SLASH', 'ザン!': 'SLASH!', '出血': 'BLEED', 'ズドッ': 'THWACK', 'ザシュッ': 'SHWING', 'ビヨーン': 'BOING',
    'ジャラジャラ': 'CLINK CLANK', 'グイッ': 'YANK', 'バン': 'BANG', 'チャリーン': 'KA-CHING', '斬!!': 'CUT!!', 'ツルッ': 'SLIP',
    'ゴロゴロ': 'ROLL ROLL', 'ピヨピヨ': 'TWEET TWEET', 'ザッ': 'POCKET SAND', 'ぽわ〜ん': 'la la la~', 'ニョロ': 'SSSS',
    'ぐるぐる': 'WRAP WRAP', 'ブスッ!!': 'STAB!!', 'チクッ': 'PRICK', 'ワサワサ': 'BZZ BZZ', 'ぺちゃんこ': 'PANCAKED',
    'ドドドッ': 'STAMPEDE', 'ガブ': 'CHOMP', 'ねばー': 'STICKY', 'ズルズル': 'SLURP', 'シャキン': 'SHING', 'ゴーン': 'BONNNG',
    'うらめしや〜': 'cursed~', '滅': '滅', 'のろ〜': 'sloooow', '尊い…': 'too precious…', '…はぁ': '…sigh', 'スパッ': 'SNIP',
    // おみくじ
    '凶…': 'BAD LUCK…', '末吉': 'MEH', '吉': 'LUCKY', '中吉': 'NICE', '大吉!': 'JACKPOT!', '大大吉!!': 'MEGA JACKPOT!!',
  };

  const L = (ja, enText) => (en ? enText : ja);
  const T = (ja) => (en && EN[ja] != null ? EN[ja] : ja);

  function applyDom() {
    if (!en) return;
    for (const el of document.querySelectorAll('[data-en]')) el.innerHTML = el.dataset.en;
    for (const el of document.querySelectorAll('[data-en-aria]')) el.setAttribute('aria-label', el.dataset.enAria);
    for (const el of document.querySelectorAll('[data-en-placeholder]')) el.setAttribute('placeholder', el.dataset.enPlaceholder);
  }
  function setLang(l) {
    try { localStorage.setItem(KEY, l); } catch (e) {}
    location.reload();
  }

  document.documentElement.lang = lang;
  window.I18N = { lang, en, L, T, applyDom, setLang };
  applyDom();   // このファイルは画面の要素より後に読み込むので、すぐ差し替えられる
})();
