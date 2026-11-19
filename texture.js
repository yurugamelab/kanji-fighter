// ギラギラ質感の文字を描く（パチンコ風）。
// 一度オフスクリーンに描いてキャッシュし、試合中はその画像を回転・拡大して使う。
(function () {
  const FONT = '"Dela Gothic One", "Hiragino Sans", "Hiragino Kaku Gothic StdN", "Yu Gothic", "Meiryo", sans-serif';
  const SCALE = 2; // 高解像度用
  // 武器の漢字（1文字）は、極太の角ゴシック「Noto Sans JP」で描く。
  // Dela Gothic One は見出し向けの極太で、画数の多い字の一部（鍋・藤・滅など）は形そのものが詰まって潰れるため。
  // 「VS」「FIGHT!」「KO」などの見出しは Dela Gothic One のまま
  const KANJI_FONT = '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic StdN", "Yu Gothic", "Meiryo", sans-serif';
  const isSingleKanji = (str) => [...str].length === 1 && /\p{Script=Han}/u.test(str);
  const fontOf = (str) => (isSingleKanji(str) ? KANJI_FONT : FONT);

  const STYLES = {
    // 赤＋金ふち（特別な字・KO表示）
    red: {
      fill: [[0, '#ffe36a'], [0.3, '#ff6a1a'], [0.5, '#a80000'], [0.78, '#ff3b14'], [1, '#ffb52e']],
      rim: [[0, '#fff7c2'], [0.45, '#d89a12'], [0.55, '#8a5800'], [1, '#ffe27a']],
      depth: '#4a0800',
      light: [[0, '#ffe36a'], [0.3, '#ff7a2a'], [0.55, '#e8321a'], [0.8, '#ff4a1a'], [1, '#ffb52e']],   // 線がとても多い字用（ほかの特別な字と同じ赤系。黒いすき間と見分けられるよう、いちばん暗い帯だけ明るくした）
    },
    // 銀（ふつうの字・VS表示）
    silver: {
      fill: [[0, '#ffffff'], [0.42, '#b9c8d8'], [0.5, '#56677c'], [0.8, '#eef4ff'], [1, '#9fb0c4']],
      rim: [[0, '#ffffff'], [0.5, '#8d99a8'], [1, '#e4ebf3']],
      depth: '#263140',
      light: [[0, '#ffffff'], [0.5, '#e6edf5'], [1, '#c3d0de']],
    },
    // 金（神・龘の封印が解けたときの演出と、図鑑のマス）
    gold: {
      fill: [[0, '#fffbe6'], [0.35, '#ffe680'], [0.5, '#c88a00'], [0.75, '#ffe15a'], [1, '#fff3b0']],
      rim: [[0, '#ffffff'], [0.5, '#e8b830'], [1, '#fff6c8']],
      depth: '#5a3a00',
      light: [[0, '#fffbe6'], [0.4, '#ffe680'], [0.6, '#f0b820'], [1, '#fff3b0']],
    },
    // 白→金＋こげ茶ふち（技名・KO表示）。画数の多い字が潰れないよう、線の細い Noto Sans JP で描く
    name: {
      fill: [[0, '#ffffff'], [0.45, '#fff6c8'], [0.55, '#ffd23a'], [1, '#ffae00']],
      rim: [[0, '#6a2400'], [1, '#2a0800']],
      depth: '#1a0500',
      kanjiFont: true,
    },
  };

  const cache = new Map();

  // 線の混み具合からふちの太さの倍率を決める（0.3〜1）
  // フォントに無い字は細い代わりのフォントで描かれ、太いふちだと字がつぶれるので細くする
  const thickCache = new Map();
  const probe = document.createElement('canvas');
  probe.width = probe.height = 128;
  const pg = probe.getContext('2d', { willReadFrequently: true });
  function edgeScale(str) {
    if (thickCache.has(str)) return thickCache.get(str);
    let worst = 1;
    for (const ch of str) {
      if (/[\x00-\x7f]/.test(ch)) continue;
      const S = 128;
      pg.clearRect(0, 0, S, S);
      pg.font = `900 100px ${fontOf(ch)}`; pg.textAlign = 'center'; pg.textBaseline = 'middle';
      pg.fillText(ch, S / 2, S / 2);
      const d = pg.getImageData(0, 0, S, S).data, on = (x, y) => d[(y * S + x) * 4 + 3] > 128;
      // 縦横の線を横切ったときの「白→黒」の回数の平均（線が細かいほど多い）
      let tr = 0, lines = 0;
      for (let i = 0; i < S; i += 2) {
        for (const vert of [false, true]) {
          let p = false, t = 0, any = false;
          for (let j = 0; j < S; j++) { const v = vert ? on(i, j) : on(j, i); if (v !== p) { t++; p = v; } if (v) any = true; }
          if (any) { tr += t / 2; lines++; }
        }
      }
      const k = lines ? Math.max(0.3, Math.min(1, 1.8 / (tr / lines))) : 1;
      worst = Math.min(worst, k);
    }
    thickCache.set(str, worst);
    return worst;
  }

  function grad(g, y0, y1, stops) {
    const lg = g.createLinearGradient(0, y0, 0, y1);
    for (const [o, c] of stops) lg.addColorStop(o, c);
    return lg;
  }

  // str を size(px) で描いた画像を返す。{ canvas, w, h }（w,h は論理サイズ）
  function render(str, size, styleName) {
    const key = `${str}|${Math.round(size)}|${styleName}`;
    if (cache.has(key)) return cache.get(key);
    const st = STYLES[styleName] || STYLES.silver;
    const font = `900 ${size}px ${st.kanjiFont ? KANJI_FONT : fontOf(str)}`;

    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    const tw = m.measureText(str).width;
    const k = edgeScale(str);
    // 線の細い字は本体を太らせ（bold）、ふちはそのぶん外側に細く付ける
    const bold = k < 0.6 ? size * 0.025 * (1 - k) : 0;   // 線がかなり細い字（フォントに無い字）だけ太らせる
    // 外から順に：黒い縁(outerW) → 金銀ふち(rimW) → 内側の黒い線(innerW) → 本体
    // 内側の黒い線が、線と線の細い隙間（鳥・重・麦など）を黒く埋めるので、線が分かれて見える
    // 武器の漢字（Noto Sans JP）は線が Dela Gothic より細いので、本体のすぐ外に太めの黒い線、その外に細い金銀の帯にする
    const kanji = isSingleKanji(str) || !!st.kanjiFont;
    // 線がとても多い字（𰻞・鬱など）は、太いふちで隙間が埋まってつぶれる。黒い細ふちだけにして（線の隙間は黒）、本体を明るい色にして、線と隙間をはっきり分ける
    const dense = kanji && k < 0.5 && !!st.light;
    const [oW, rW, iW] = dense ? [0.07, 0, 0] : kanji ? [0.205, 0.155, 0.10] : [0.15, 0.11, 0.045];
    const kk = dense ? 1 : k;
    const outerW = size * oW * kk + bold, rimW = size * rW * kk + bold, innerW = size * iW * kk + bold;
    const depth = Math.max(3, Math.round(size * 0.07 * (0.5 + k / 2)));
    const pad = (dense ? outerW + size * 0.1 : outerW) + 4;
    const w = Math.ceil(tw + pad * 2), h = Math.ceil(size * 1.25 + pad * 2 + depth);
    const cx = w / 2, cy = pad + size * 0.62;
    const top = cy - size * 0.55, bottom = cy + size * 0.55;

    const c = document.createElement('canvas');
    c.width = w * SCALE; c.height = h * SCALE;
    const g = c.getContext('2d');
    g.scale(SCALE, SCALE);
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';

    // 1) 立体の厚み（下に押し出す）
    g.lineWidth = dense ? outerW + size * 0.1 : outerW; g.strokeStyle = '#000';   // 線がとても多い字も、ほかの字と同じくらいの厚みにする
    for (let d = depth; d >= 1; d--) g.strokeText(str, cx + d * 0.25, cy + d);
    g.lineWidth = dense ? outerW + size * 0.05 : rimW; g.strokeStyle = st.depth; g.fillStyle = st.depth;
    for (let d = depth; d >= 1; d--) { g.strokeText(str, cx + d * 0.25, cy + d); g.fillText(str, cx + d * 0.25, cy + d); }

    // 2) 黒ふち → 金(銀)ふち
    // 線がとても多い字は、外側だけに金(銀)ふち：太い金のふちを先に描き、その上に黒ふち（すき間は黒くなり、外まわりだけ金が残る）
    if (dense) { g.lineWidth = outerW + size * 0.07; g.strokeStyle = grad(g, top, bottom, st.rim); g.strokeText(str, cx, cy); }
    g.lineWidth = outerW; g.strokeStyle = '#000'; g.strokeText(str, cx, cy);
    if (rimW > 0) { g.lineWidth = rimW; g.strokeStyle = grad(g, top, bottom, st.rim); g.strokeText(str, cx, cy); }
    if (innerW > 0) { g.lineWidth = innerW; g.strokeStyle = '#140a04'; g.strokeText(str, cx, cy); }

    // 3) 本体（グラデーション＋上半分のハイライト）を別レイヤーで作って重ねる
    const t = document.createElement('canvas');
    t.width = c.width; t.height = c.height;
    const tg = t.getContext('2d');
    tg.scale(SCALE, SCALE);
    tg.font = font; tg.textAlign = 'center'; tg.textBaseline = 'middle';
    tg.fillStyle = grad(tg, top, bottom, dense ? st.light : st.fill);
    tg.fillText(str, cx, cy);
    if (bold > 0.5) { tg.lineJoin = 'round'; tg.lineWidth = bold; tg.strokeStyle = tg.fillStyle; tg.strokeText(str, cx, cy); }
    // 本体の線のまわりを少し削って、線と線の細い隙間を広げる（下の黒い線が溝として見える）
    const erode = size * (kanji ? 0.012 : 0.028) * k;
    // 武器の漢字（Noto Sans JP）は字の形が重なり合う部品でできていて、削ると部品の境目に筋が出るので削らない
    if (erode > 0.6 && bold <= 0.5 && !kanji) {   // 太らせた字（フォントに無い字）も削らない
      tg.globalCompositeOperation = 'destination-out';
      tg.lineJoin = 'round'; tg.lineWidth = erode; tg.strokeStyle = '#000';
      tg.strokeText(str, cx, cy);
      tg.globalCompositeOperation = 'source-over';
    }
    tg.globalCompositeOperation = 'source-atop';
    tg.fillStyle = grad(tg, top, cy, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
    tg.fillRect(0, top, w, cy - top);
    // ななめの光
    {
    tg.fillStyle = 'rgba(255,255,255,0.35)';
    tg.beginPath();
    tg.moveTo(cx - size * 0.1, top); tg.lineTo(cx + size * 0.12, top);
    tg.lineTo(cx - size * 0.2, bottom); tg.lineTo(cx - size * 0.42, bottom);
    tg.closePath(); tg.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(t, 0, 0);
    g.scale(SCALE, SCALE);

    // 4) 輪郭を細い線で締める
    if (bold <= 0.5 && !kanji) {   // 太らせた字・武器の漢字は、細い輪郭線を描くと二重線や筋に見えるので描かない
      g.lineWidth = Math.max(0.6, size * 0.015); g.strokeStyle = 'rgba(40,0,0,0.6)';
      g.strokeText(str, cx, cy);
    }

    const out = { canvas: c, w, h, oy: cy - h / 2 }; // oy: 画像中心から文字中心までのずれ
    cache.set(key, out);
    return out;
  }

  // 中心(x,y)に回転して描く
  function draw(ctx, str, x, y, size, styleName, rot, scale) {
    const img = render(str, size, styleName);
    const s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.drawImage(img.canvas, -img.w / 2, -img.h / 2 - img.oy, img.w, img.h);
    ctx.restore();
  }

  // 幅に収まるサイズを求める
  const measurer = document.createElement('canvas').getContext('2d');
  const fitCache = new Map();
  function fitSize(str, size, maxW) {
    const key = `${str}|${size}|${maxW}`;
    if (fitCache.has(key)) return fitCache.get(key);
    measurer.font = `900 ${size}px ${fontOf(str)}`;
    const tw = measurer.measureText(str).width + size * 0.45;
    const r = tw > maxW ? size * maxW / tw : size;
    fitCache.set(key, r);
    return r;
  }

  // フォントを先読み（オフラインなどで失敗しても待ちすぎない）
  function preload(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const p = Promise.all([
      document.fonts.load(`900 64px "Dela Gothic One"`, text),
      document.fonts.load(`900 64px "Noto Sans JP"`, text),
    ]).catch(() => {});
    return Promise.race([p, new Promise((r) => setTimeout(r, 1500))]);
  }
  const listeners = [];
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => {
    cache.clear(); fitCache.clear(); thickCache.clear();
    for (const f of listeners) f();
  });
  const onFontChange = (f) => listeners.push(f);

  window.Texture = { FONT, render, draw, fitSize, preload, onFontChange };
})();
