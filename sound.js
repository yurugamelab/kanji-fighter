// 効果音（Web Audio で合成。音声ファイルは使わない）
// スマホのブラウザは、ユーザーが一度タップするまで音を鳴らせない。
(function () {
  let ac = null, master = null, noiseBuf = null, muted = false;
  try { muted = localStorage.getItem('kf-muted') === '1'; } catch (e) {}
  const lastAt = {};

  // iPhone：マナーモード（消音スイッチ）のままだと、Web Audio の音はスピーカーから出ない（イヤフォンだけ鳴る）。
  // 「音楽の再生」扱いにして、マナーモードでも鳴るようにする。
  //   iOS 17 以降：navigator.audioSession で指定できる
  //   それより前：無音の <audio> を1回再生すると、同じ扱いに切り替わる
  let sessionSet = false;
  function playbackSession() {
    if (sessionSet) return;
    sessionSet = true;
    try {
      if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; }
      // 0.1秒の無音の WAV をその場で作って鳴らす（タップの中で呼ぶこと）
      const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
      v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
      const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      el.setAttribute('playsinline', ''); el.volume = 0.01;
      const p = el.play(); if (p && p.catch) p.catch(() => { sessionSet = false; });
    } catch (e) {}
  }
  function ensure() {
    playbackSession();
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.45; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // 音程つきの音。f1 を渡すと音程が変わっていく
  function tone(type, f0, f1, dur, vol, delay) {
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // ザッという音（ノイズ）
  function hiss(dur, vol, freq, q, delay, ftype) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise();
    f.type = ftype || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5, dur + 0.05);
  }
  const notes = (list, type, len, vol, gap) => list.forEach((f, i) => tone(type, f, null, len, vol, i * gap));

  // size: 武器の大きさ(px)。大きい字ほど低く重い音になる
  const pitch = (size) => Math.max(0.45, Math.min(1.6, 90 / (size || 90)));
  // 鐘のような余韻の長い音（倍音を重ねる）
  function bell(f, dur, vol, delay) {
    for (const [m, v] of [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.9, 0.12]]) tone('sine', f * m, null, dur / m * 1.6, vol * v, delay);
  }
  const SOUNDS = {
    swing(size) { const k = pitch(size); hiss(0.12, 0.12, 1600 * k, 1.5); },
    // 打撃：ドスッという胴鳴り＋パシッという破裂音。強いほど低く長く
    hit(dmg, size) {
      const v = Math.min(1, 0.4 + (dmg || 0) / 25), k = pitch(size);
      tone('sine', 160 * k, 38, 0.22 + v * 0.1, 0.85 * v);            // 胴鳴り
      tone('square', 420 * k, 110, 0.05, 0.12 * v);                   // パンッ
      hiss(0.05, 0.55 * v, 3200, 0.7, 0, 'highpass');                 // 破裂
      hiss(0.12, 0.45 * v, 1300 * k, 0.9);                            // ザッ
      if (dmg >= 15) SOUNDS.bighit(dmg);
    },
    bighit(dmg) {
      const v = Math.min(1, 0.5 + (dmg || 0) / 40);
      tone('sine', 85, 28, 0.55, 0.9 * v);
      tone('triangle', 220, 55, 0.35, 0.25 * v);
      hiss(0.45, 0.5 * v, 700, 0.6, 0, 'lowpass');
      hiss(0.08, 0.4 * v, 5000, 0.5, 0, 'highpass');
    },
    // 属性ごとの音
    fire() { hiss(0.55, 0.45, 900, 0.6); hiss(0.3, 0.3, 300, 0.5, 0, 'lowpass'); for (let i = 0; i < 6; i++) hiss(0.03, 0.25, 4000, 2, 0.05 + Math.random() * 0.4, 'highpass'); },
    ice() { hiss(0.08, 0.35, 6000, 3, 0, 'highpass'); for (let i = 0; i < 5; i++) tone('triangle', 2400 + Math.random() * 2400, null, 0.18, 0.06, i * 0.035); },
    zap() { tone('sawtooth', 90, 60, 0.35, 0.18); tone('square', 1800, 300, 0.12, 0.08); hiss(0.3, 0.3, 2500, 4); },
    slash() { hiss(0.16, 0.4, 5200, 2, 0, 'highpass'); tone('triangle', 3200, 1400, 0.1, 0.06); },
    water() { hiss(0.5, 0.45, 600, 0.8); tone('sine', 300, 120, 0.25, 0.25); },
    // 必殺技：カットイン（ズバッ＋太鼓＋決めの和音）
    cutin() {
      hiss(0.35, 0.35, 1800, 1.2);
      tone('sawtooth', 120, 900, 0.28, 0.07);
      tone('sine', 110, 45, 0.35, 0.9, 0.12); hiss(0.15, 0.3, 400, 0.8, 0.12, 'lowpass');
      tone('sine', 110, 45, 0.35, 0.9, 0.3); hiss(0.15, 0.3, 400, 0.8, 0.3, 'lowpass');
      notes([330, 349, 440, 494, 659], 'square', 0.1, 0.07, 0.05);
      for (const f of [330, 494, 659]) tone('square', f, null, 0.6, 0.05, 0.45);
    },
    coin() { notes([1976, 2637], 'square', 0.06, 0.06, 0.05); },
    slap() { hiss(0.07, 0.5, 2600, 1.2); tone('square', 320, 120, 0.06, 0.18); },
    temple() { SOUNDS.boom(); bell(110, 3.4, 0.32, 0); bell(166, 2.6, 0.16, 0.02); bell(331, 1.4, 0.06, 0.03); },
    superhit() { SOUNDS.bighit(40); SOUNDS.boom(); bell(220, 1.6, 0.18, 0.05); },
    gauge() { notes([659, 880, 1319], 'square', 0.07, 0.07, 0.05); },
    guard() { tone('square', 1300, 900, 0.05, 0.1); tone('triangle', 2600, null, 0.09, 0.08, 0.01); },
    proc() { notes([880, 1175, 1568], 'triangle', 0.09, 0.13, 0.06); },
    shoot() { hiss(0.18, 0.18, 2800, 2); tone('sawtooth', 500, 180, 0.15, 0.06); },
    boom() { hiss(0.6, 0.8, 500, 0.7, 0, 'lowpass'); tone('sine', 90, 28, 0.5, 0.8); },
    clang() { tone('square', 1500, 1300, 0.16, 0.08); tone('square', 2250, 2000, 0.12, 0.05, 0.01); },
    vs() { tone('sawtooth', 160, 480, 0.35, 0.08); hiss(0.35, 0.12, 1200, 1); },
    fight() { tone('square', 523, null, 0.12, 0.12); tone('square', 784, null, 0.35, 0.14, 0.12); },
    // KO：重い一撃 → 爆発 → ゴーンという鐘
    ko() {
      SOUNDS.bighit(40); SOUNDS.boom();
      tone('square', 440, 90, 0.9, 0.12, 0.05);
      bell(110, 3, 0.35, 0.35);
      hiss(1.2, 0.18, 300, 0.5, 0.35, 'lowpass');
    },
    timeup() { notes([660, 660, 440], 'square', 0.18, 0.1, 0.2); },
    win() { notes([523, 659, 784, 1047], 'square', 0.16, 0.1, 0.11); tone('square', 1047, null, 0.5, 0.1, 0.44); },
    lose() { notes([392, 370, 349], 'triangle', 0.3, 0.14, 0.26); tone('triangle', 330, 220, 0.8, 0.14, 0.78); },
    click() { tone('sine', 1100, null, 0.05, 0.12); },
    unlock() {   // 封印が解けたとき
      SOUNDS.boom();
      notes([392, 523, 659, 784, 1047, 1319], 'square', 0.14, 0.1, 0.1);
      tone('triangle', 1568, null, 0.9, 0.12, 0.62);
    },
  };

  function play(name, a, b) {
    if (muted || !SOUNDS[name]) return;
    if (!ensure() || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (lastAt[name] && now - lastAt[name] < 0.04) return; // 同じ音の重なりすぎ防止
    lastAt[name] = now;
    try { SOUNDS[name](a, b); } catch (e) {}
  }
  function setMuted(v) {
    muted = v;
    try { localStorage.setItem('kf-muted', v ? '1' : '0'); } catch (e) {}
    if (muted) Bgm.pause(); else Bgm.resume();
  }

  // =====================================================================
  // BGM：和風チップチューン（都節音階 ミ・ファ・ラ・シ・ド）
  //   メロディは「音階の何番目か」で書く。0=ミ 1=ファ 2=ラ 3=シ 4=ド 5=上のミ …
  //   . は休み、_ は前の音をのばす。1文字＝8分音符
  // =====================================================================
  const SCALE = [0, 1, 5, 7, 8];
  const deg = (d, base) => base + SCALE[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
  const mfreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // 1小節＝8文字。数字は0〜9、10以上は a,b,c…（10=a）
  const parse = (s) => s.replace(/\s|\|/g, '').split('').map((c) => (c === '.' || c === '_' ? c : parseInt(c, 36)));
  const SONGS = {
    // 対戦：速くて勢いのある曲
    battle: {
      bpm: 168, base: 64, wave: 'square', vol: 0.07,
      lead: parse(
        '5_45 7_54 | 3_23 4_.. | 5_45 7_87 | 9_87 5_.. |' +
        '5_45 7_54 | 3_23 4_32 | 1_23 4_32 | 0___ ....|' +
        '7787 5_45 | 7_54 3_2_ | 8898 7_57 | a_98 7___ |' +
        'a_98 7_87 | 5_45 7_54 | 3_45 4_32 | 0___ 0.0.'),
      // 小節ごとの低音（音階の番号、ひとつ下のオクターブ）
      bass: [0, 2, 0, 1, 0, 2, 1, 0, 2, 0, 3, 2, 4, 2, 1, 0],
      drums: true,
    },
    // タイトル：これから戦うぞ、という勢いのある曲（対戦よりは少しゆっくり）
    title: {
      bpm: 138, base: 64, wave: 'square', vol: 0.065,
      lead: parse(
        '0_2_ 3_5_ | 4_3_ 2___ | 0_2_ 3_4_ | 5___ ....|' +
        '7_5_ 4_5_ | 7_8_ 7___ | 5_4_ 3_2_ | 3___ ....|' +
        '0_2_ 3_5_ | 4_3_ 2___ | 0_2_ 3_4_ | 5___ 7_8_|' +
        'a___ 9_8_ | 7___ 5_4_ | 3_4_ 2_1_ | 0___ ....'),
      bass: [0, 2, 0, 0, 2, 3, 2, 3, 0, 2, 0, 0, 4, 2, 1, 0],
      drums: true,
    },
    // 結果：ゆったりした琴っぽい曲
    menu: {
      bpm: 96, base: 64, wave: 'triangle', vol: 0.11, pluck: true,
      lead: parse(
        '5_._ 4_3_ | 2___ ..._ | 3_4_ 5_7_ | 5___ ....|' +
        '7_5_ 4_3_ | 4_._ 2_1_ | 0_1_ 2_3_ | 0___ ....'),
      bass: [0, 2, 1, 0, 2, 1, 2, 0],
      drums: false,
    },
  };
  let bgmGain = null, bgmName = null, bgmTimer = null, nextTime = 0, stepIdx = 0, paused = false;
  function bgmNote(type, f, t, dur, vol, pluck) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    if (pluck) g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.25, dur));
    else { g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + dur); }
    o.connect(g); g.connect(bgmGain);
    o.start(t); o.stop(t + Math.max(0.3, dur) + 0.05);
  }
  function bgmDrum(kind, t) {
    if (kind === 'kick') {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + 0.2);
      return;
    }
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const v = kind === 'hat' ? 0.07 : 0.28, d = kind === 'hat' ? 0.03 : 0.12;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); g.connect(bgmGain);
    s.start(t, Math.random() * 0.5, d + 0.02);
  }
  // 8分音符ひとつぶんを鳴らす予約
  function schedule(song, i, t) {
    const n = song.lead.length, e8 = 60 / song.bpm / 2;
    const v = song.lead[i % n];
    if (typeof v === 'number') {
      let len = 1;
      while (song.lead[(i + len) % n] === '_' && len < 8) len++;
      bgmNote(song.wave, mfreq(deg(v, song.base)), t, e8 * len * 0.95, song.vol, song.pluck);
    }
    const bar = Math.floor((i % n) / 8), pos = i % 8;
    const root = deg(song.bass[bar % song.bass.length], song.base - 24);
    if (song.drums) {
      bgmNote('triangle', mfreq(root + (pos % 2 ? 12 : 0)), t, e8 * 0.9, 0.16);    // ドンドン跳ねる低音
      if (pos === 0 || pos === 4 || pos === 7) bgmDrum('kick', t);
      if (pos === 2 || pos === 6) bgmDrum('snare', t);
      bgmDrum('hat', t);
    } else if (pos === 0 || pos === 4) {
      bgmNote('triangle', mfreq(root + 12), t, e8 * 3.5, 0.09, true);
      if (pos === 0) bgmNote('triangle', mfreq(root + 19), t + e8, e8 * 3, 0.05, true);
    }
  }
  function tick() {
    if (!ac || !bgmName || paused) return;
    const song = SONGS[bgmName], e8 = 60 / song.bpm / 2;
    if (nextTime < ac.currentTime) nextTime = ac.currentTime + 0.05;   // 止まっていたら今から
    while (nextTime < ac.currentTime + 0.15) {
      schedule(song, stepIdx++, nextTime);
      nextTime += e8;
    }
  }
  const Bgm = {
    // 同じ曲なら続けて鳴らす。違う曲なら頭から
    play(name) {
      if (name === bgmName) { Bgm.resume(); return; }
      Bgm.stop();
      bgmName = name;
      if (muted || !ensure()) return;
      if (!bgmGain) { bgmGain = ac.createGain(); bgmGain.connect(master); }
      bgmGain.gain.cancelScheduledValues(ac.currentTime);
      bgmGain.gain.setValueAtTime(0.9, ac.currentTime);
      stepIdx = 0; nextTime = ac.currentTime + 0.05; paused = false;
      if (!bgmTimer) bgmTimer = setInterval(tick, 30);
      tick();
    },
    // 新しい音を出さない（鳴っている音はすぐ消える）
    stop(fade) {
      if (bgmGain && ac) {
        const t = ac.currentTime;
        bgmGain.gain.cancelScheduledValues(t);
        bgmGain.gain.setValueAtTime(bgmGain.gain.value, t);
        bgmGain.gain.linearRampToValueAtTime(0.0001, t + (fade || 0.05));
        const g = bgmGain; bgmGain = null;
        setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (fade || 0.05) * 1000 + 600);
      }
      bgmName = null;
    },
    pause() { paused = true; if (bgmGain && ac) bgmGain.gain.setValueAtTime(0.0001, ac.currentTime); },
    resume() {
      if (muted || !bgmName || !ensure()) return;
      if (!bgmGain) { bgmGain = ac.createGain(); bgmGain.connect(master); }
      bgmGain.gain.setValueAtTime(0.9, ac.currentTime);
      if (paused) { paused = false; nextTime = ac.currentTime + 0.05; }
      if (!bgmTimer) bgmTimer = setInterval(tick, 30);
    },
    // 必殺技のカットイン中などに、少しだけ小さくする
    duck(sec) {
      if (!bgmGain || !ac) return;
      const t = ac.currentTime;
      bgmGain.gain.cancelScheduledValues(t);
      bgmGain.gain.setValueAtTime(0.25, t);
      bgmGain.gain.linearRampToValueAtTime(0.9, t + sec);
    },
    get name() { return bgmName; },
  };

  window.Sfx = { play, unlock: ensure, get muted() { return muted; }, setMuted };
  window.Bgm = Bgm;
})();
