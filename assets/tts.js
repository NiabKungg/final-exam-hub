/* ============================================================
   tts.js — อ่านออกเสียงด้วย Web Speech API (ฟรี ในตัวเบราว์เซอร์)
   เปิดใช้เฉพาะหน้าที่ <body data-tts="1">
   - ปุ่ม 🔊 หน้าแต่ละหัวข้อ h2 / หัวข้อย่อย h3 และแต่ละ step
   - แถบควบคุมลอย: เลือกเสียงไทย/อังกฤษ, ความเร็ว, พัก/หยุด, อ่านทั้งหน้า
   - เครื่องที่ไม่มีเสียงไทย (เช่น Chrome บน Linux) มีตัวเลือก
     "เสียงออนไลน์ไทย" เล่นผ่าน Audio element โดยใช้เน็ต
   - โค้ด/สมการ/SVG ไม่อ่าน (แทนด้วยคำสั้น ๆ) — อ่านเฉพาะเนื้อหาคำบรรยาย
   ============================================================ */
'use strict';
(function () {
  if (document.body.dataset.tts !== '1') return;
  if (!('speechSynthesis' in window)) return;

  const LS_KEY = 'feh-tts';
  const THAI_RE = /[\u0E00-\u0E7F]/;
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}\u{2764}]/gu;
  /* ค่าพิเศษใน <select> = ใช้เสียงออนไลน์แทนเสียงในเครื่อง */
  const ONLINE_TH = '__online_th';
  const ONLINE_EN = '__online_en';
  const ONLINE_LABEL_TH = '🇹🇭 เสียงออนไลน์ไทย (ใช้เน็ต)';
  const ONLINE_LABEL_EN = '🔊 เสียงออนไลน์อังกฤษ (ใช้เน็ต)';

  const state = {
    rate: 1,
    chunks: [], idx: 0, playing: false, paused: false, stopped: true,
    target: null, label: '', epoch: 0,
    audio: null,           /* HTMLAudioElement ที่กำลังเล่น (โหมดออนไลน์) */
  };

  /* ---------- ตั้งค่าที่บันทึกไว้ ---------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (p.rate) state.rate = p.rate;
      state._savedTh = p.th || '';
      state._savedEn = p.en || '';
    } catch (e) { /* ไม่มีค่าเดิมก็ข้าม */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        th: el.selTh ? el.selTh.value : '',
        en: el.selEn ? el.selEn.value : '',
        rate: state.rate,
      }));
    } catch (e) { /* localStorage ใช้ไม่ได้ก็ไม่เป็นไร */ }
  }

  /* ---------- รายชื่อเสียง ---------- */
  function allVoices() {
    const vs = speechSynthesis.getVoices();
    const uniq = new Map();
    vs.forEach((v) => { if (!uniq.has(v.name)) uniq.set(v.name, v); });
    return [...uniq.values()];
  }
  function fillSelect(sel, entries, savedValue) {
    sel.innerHTML = '';
    entries.forEach((e) => {
      const o = document.createElement('option');
      o.value = e.value;
      o.textContent = e.label;
      sel.appendChild(o);
    });
    if (savedValue && entries.some((e) => e.value === savedValue)) sel.value = savedValue;
  }
  function refreshVoices() {
    const list = allVoices();
    if (!list.length) return;
    const th = list.filter((v) => /^th/i.test(v.lang));
    const en = list.filter((v) => /^en/i.test(v.lang));
    const rest = list.filter((v) => !/^th/i.test(v.lang) && !/^en/i.test(v.lang));
    /* เสียงไทย: ถ้าเครื่องไม่มี ให้เพิ่มตัวเลือก "เสียงออนไลน์ไทย" ไว้บนสุด */
    const thEntries = (th.length ? [] : [{ value: ONLINE_TH, label: ONLINE_LABEL_TH }])
      .concat(th.map((v) => ({ value: v.name, label: '🇹🇭 ' + v.name + ' (' + v.lang + ')' })))
      .concat(en.map((v) => ({ value: v.name, label: v.name + ' (' + v.lang + ')' })))
      .concat(rest.map((v) => ({ value: v.name, label: v.name + ' (' + v.lang + ')' })));
    /* เสียงอังกฤษ: ใส่ตัวออนไลน์ไว้ท้ายสุด (เครื่องส่วนใหญ่มีเสียงอังกฤษอยู่แล้ว) */
    const enEntries = en.map((v) => ({ value: v.name, label: v.name + ' (' + v.lang + ')' }))
      .concat(th.map((v) => ({ value: v.name, label: '🇹🇭 ' + v.name + ' (' + v.lang + ')' })))
      .concat([{ value: ONLINE_EN, label: ONLINE_LABEL_EN }]);
    const savedTh = state._savedTh || (th.length ? '' : ONLINE_TH);
    const savedEn = state._savedEn || '';
    fillSelect(el.selTh, thEntries, savedTh);
    fillSelect(el.selEn, enEntries, savedEn);
    updateHint(th.length > 0, el.selTh.value === ONLINE_TH);
  }
  function isOnlineSel(sel) { return sel.value === ONLINE_TH || sel.value === ONLINE_EN; }
  function updateHint(hasThai, usingOnline) {
    el.hint.textContent = hasThai
      ? (usingOnline ? '' : '')
      : 'ไม่มีเสียงไทยในเครื่อง — เลือก "' + ONLINE_LABEL_TH + '" ได้เลย (ต้องต่ออินเทอร์เน็ต)';
  }

  /* ---------- ดึงข้อความจาก DOM ---------- */
  function cleanText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, input, button, label, select, svg, .tts-btn').forEach((n) => n.remove());
    /* โค้ดโปรแกรมไม่อ่านเป็นเสียง — แทนด้วยคำสั้น ๆ */
    clone.querySelectorAll('pre').forEach((p) => {
      p.replaceWith(document.createTextNode(' (โค้ดโปรแกรม — ดูตัวอักษรในหน้าเว็บ) '));
    });
    /* ปิด details ที่ยังไม่เปิด → อ่านแค่หัวเรื่อง ไม่อ่านเฉลยที่ซ่อนอยู่ */
    clone.querySelectorAll('details:not([open])').forEach((d) => {
      const s = d.querySelector('summary');
      d.innerHTML = '';
      if (s) d.appendChild(s.cloneNode(true));
    });
    let text = clone.textContent || '';
    text = text.replace(EMOJI_RE, ' ');
    text = text.replace(/[\t\r]+/g, ' ').replace(/[ \u00A0]+/g, ' ');
    text = text.replace(/\n{2,}/g, '\n').replace(/\n /g, '\n').trim();
    return text;
  }

  /* ---------- หั่นข้อความเป็นท่อน ๆ สำหรับอ่าน ---------- */
  function chunkText(text) {
    const parts = text.split(/\n+/).flatMap((para) => {
      const sents = para.split(/(?<=[\.!?;:ๆ])\s+/);
      const out = [];
      for (let s of sents) {
        s = s.trim();
        if (!s) continue;
        if (s.length <= 200) { out.push(s); continue; }
        /* ท่อนยาวเกิน: หั่นตรงช่องว่างใกล้ ๆ 180 ตัวอักษร */
        let rest = s;
        while (rest.length > 200) {
          let cut = rest.lastIndexOf(' ', 180);
          if (cut < 60) cut = 180;
          out.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        if (rest) out.push(rest);
      }
      return out;
    });
    /* รวมท่อนสั้น ๆ ที่ติดกันให้อ่านต่อเนื่อง */
    const merged = [];
    for (const p of parts) {
      if (merged.length && (merged[merged.length - 1] + ' ' + p).length <= 200) {
        merged[merged.length - 1] += ' ' + p;
      } else merged.push(p);
    }
    return merged.filter(Boolean).map((t) => ({ text: t, thai: THAI_RE.test(t) }));
  }

  /* ---------- เครื่องยนต์อ่าน ---------- */
  function startRead(target, label) {
    const text = cleanText(target);
    if (!text) { setStatus('ไม่พบข้อความให้อ่าน'); return; }
    stopAudio();
    speechSynthesis.cancel();
    state.epoch += 1;
    state.stopped = false; state.playing = true; state.paused = false;
    state.target = target; state.label = label;
    state.chunks = chunkText(text); state.idx = 0;
    const anchor = target.__anchor || target;
    markReading(anchor);
    if (typeof anchor.scrollIntoView === 'function') {
      try { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* เลื่อนไม่ได้ก็อ่านต่อ */ }
    }
    setStatus('กำลังอ่าน: ' + label);
    el.pauseBtn.textContent = '⏸ พัก';
    /* Chrome มีบั๊ก: cancel() ตามด้วย speak() ทันทีทำให้ท่อนแรกถูกทิ้งเงียบ ๆ
       — หน่วงนิดหนึ่งก่อนเริ่มอ่านท่อนแรก (guard ด้วย epoch กันกรณีกดหยุดระหว่างรอ) */
    const ep = state.epoch;
    setTimeout(() => {
      if (!state.stopped && ep === state.epoch) speakChunk(0, ep);
    }, 120);
  }
  function speakChunk(i, epoch) {
    if (state.stopped || epoch !== state.epoch) return;
    if (i >= state.chunks.length) { finish(); return; }
    state.idx = i;
    const c = state.chunks[i];
    const sel = c.thai ? el.selTh : el.selEn;
    const progress = '(' + (i + 1) + '/' + state.chunks.length + ') ' + state.label;
    /* โหมดออนไลน์ — เล่นผ่าน Audio element */
    if (isOnlineSel(sel)) {
      setStatus('กำลังอ่าน' + (state.paused ? ' (พักอยู่) ' : ' ') + progress + ' · เสียงออนไลน์');
      playAudio(c.text, c.thai ? 'th' : 'en', i, epoch);
      return;
    }
    /* โหมดเสียงในเครื่อง — Web Speech API */
    const u = new SpeechSynthesisUtterance(c.text);
    const v = allVoices().find((x) => x.name === sel.value);
    if (v) u.voice = v;
    u.lang = c.thai ? 'th-TH' : 'en-US';
    u.rate = state.rate;
    u.onend = () => {
      if (epoch !== state.epoch || state.stopped || state.paused) return;
      setTimeout(() => speakChunk(i + 1, epoch), 60);
    };
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled' && epoch === state.epoch) finish();
    };
    setStatus('กำลังอ่าน ' + progress);
    speechSynthesis.speak(u);
  }
  function playAudio(text, lang, i, epoch, attempt) {
    const tryN = attempt || 0;
    const a = new Audio('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + lang
      + '&q=' + encodeURIComponent(text));
    a.playbackRate = Math.min(2, Math.max(0.5, state.rate));
    state.audio = a;
    a.onended = () => {
      state.audio = null;
      if (epoch !== state.epoch || state.stopped || state.paused) return;
      setTimeout(() => speakChunk(i + 1, epoch), 120);
    };
    a.onerror = () => {
      state.audio = null;
      if (epoch !== state.epoch || state.stopped) return;
      /* ลองใหม่ 1 ครั้ง (เน็ตสะดุด) ถ้ายังไม่ได้ ให้ข้ามท่อนนี้ไปท่อนถัดไป */
      if (tryN < 1) { setTimeout(() => { if (epoch === state.epoch && !state.stopped) playAudio(text, lang, i, epoch, tryN + 1); }, 500); return; }
      setStatus('โหลดเสียงออนไลน์ท่อนนี้ไม่สำเร็จ — ข้ามไปท่อนถัดไป');
      setTimeout(() => speakChunk(i + 1, epoch), 300);
    };
    const p = a.play();
    if (p && p.catch) {
      p.catch(() => {
        if (epoch !== state.epoch || state.stopped) return;
        setStatus('เบราว์เซอร์บล็อกการเล่นเสียง — กดปุ่ม 🔊 อ่าน อีกครั้ง');
        state.stopped = true; state.playing = false;
        clearReading();
      });
    }
  }
  function stopAudio() {
    if (state.audio) {
      const a = state.audio;
      a.onended = null; a.onerror = null;
      a.pause();
      state.audio = null;
    }
  }
  function stopAll() {
    state.epoch += 1;
    state.stopped = true; state.playing = false; state.paused = false;
    stopAudio();
    speechSynthesis.cancel();
    clearReading();
    setStatus('หยุดแล้ว');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function togglePause() {
    if (!state.playing) return;
    if (state.paused) {
      if (state.audio) state.audio.play();
      else speechSynthesis.resume();
      state.paused = false; el.pauseBtn.textContent = '⏸ พัก'; setStatus('กำลังอ่าน: ' + state.label);
    } else {
      if (state.audio) state.audio.pause();
      else speechSynthesis.pause();
      state.paused = true; el.pauseBtn.textContent = '▶ เล่นต่อ'; setStatus('พักการอ่านอยู่');
    }
  }
  function finish() {
    state.playing = false; state.paused = false; state.stopped = true;
    stopAudio();
    clearReading();
    setStatus('อ่านจบแล้ว ✓');
    el.pauseBtn.textContent = '⏸ พัก';
  }
  function setStatus(t) { el.status.textContent = t; }
  function markReading(t) { clearReading(); t.classList.add('tts-reading'); }
  function clearReading() { document.querySelectorAll('.tts-reading').forEach((n) => n.classList.remove('tts-reading')); }

  /* ---------- ปุ่ม 🔊 หน้าหัวข้อ/step ---------- */
  function makeBtn(target, label, cls, text) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tts-btn' + (cls ? ' ' + cls : '');
    b.textContent = text || '🔊 อ่าน';
    b.setAttribute('aria-label', 'อ่านออกเสียง: ' + label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.playing && state.target === target) stopAll();
      else startRead(target, label);
    });
    return b;
  }
  /* เนื้อหาของหัวข้อ = ทุก node ถัดจากหัวข้อ จนถึงหัวข้อระดับเดียวกัน/สูงกว่าถัดไป */
  function headingContent(head, stopAt) {
    const box = document.createElement('div');
    let node = head.nextElementSibling;
    while (node && !stopAt.test(node.tagName)) {
      box.appendChild(node.cloneNode(true));
      node = node.nextElementSibling;
    }
    const clone = head.cloneNode(true);
    clone.querySelectorAll('.tts-btn').forEach((n) => n.remove());
    box.prepend(clone);
    return box;
  }
  function injectButtons() {
    /* ระดับหัวข้อใหญ่ h2 — อ่านทั้งหัวข้อจนถึง h2 ถัดไป */
    document.querySelectorAll('main > h2[id]').forEach((h2) => {
      const box = headingContent(h2, /^H2$/);
      box.__anchor = h2;
      const name = h2.textContent.replace(EMOJI_RE, '').trim().slice(0, 60);
      h2.appendChild(makeBtn(box, name, 'tts-sec'));
    });
    /* ระดับหัวข้อย่อย h3 — อ่านเฉพาะท่อนของหัวข้อนั้น */
    document.querySelectorAll('main h3').forEach((h3) => {
      if (h3.querySelector('.tts-btn') || h3.closest('aside')) return;
      const sub = headingContent(h3, /^H[123]$/);
      sub.__anchor = h3;
      h3.appendChild(makeBtn(sub, h3.textContent.replace(EMOJI_RE, '').trim().slice(0, 60), 'tts-sub'));
    });
    /* แต่ละ step (การ์ดทีละขั้น) — ปุ่มไอคอนเล็กมุมการ์ด */
    document.querySelectorAll('main .steps .step').forEach((step, i) => {
      if (step.querySelector('.tts-btn')) return;
      const ttl = step.querySelector('h4');
      const label = (ttl ? ttl.textContent : 'ขั้นที่ ' + (i + 1)).replace(EMOJI_RE, '').trim().slice(0, 50);
      step.appendChild(makeBtn(step, label, 'tts-step', '🔊'));
    });
  }

  /* ---------- แถบควบคุมลอย ---------- */
  const el = {};
  function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'tts-bar';
    bar.innerHTML = `
      <div class="tts-bar-head">
        <span class="tts-bar-title">🔊 อ่านออกเสียง</span>
        <button type="button" class="tts-fold" aria-label="ย่อ/กางแถบควบคุม">▾</button>
      </div>
      <div class="tts-bar-body">
        <div class="tts-status" role="status">พร้อม — กดปุ่ม 🔊 อ่าน ที่หัวข้อหรือขั้นตอนที่ต้องการฟัง</div>
        <div class="tts-row">
          <label>เสียงไทย <select class="tts-vth"></select></label>
          <label>เสียงอังกฤษ <select class="tts-ven"></select></label>
        </div>
        <div class="tts-row">
          <label>ความเร็ว
            <select class="tts-rate">
              <option value="0.75">ช้า 0.75×</option>
              <option value="0.9">ช้านิด 0.9×</option>
              <option value="1" selected>ปกติ 1×</option>
              <option value="1.15">เร็วนิด 1.15×</option>
              <option value="1.3">เร็ว 1.3×</option>
              <option value="1.5">เร็วมาก 1.5×</option>
            </select>
          </label>
          <button type="button" class="tts-pause">⏸ พัก</button>
          <button type="button" class="tts-stop">⏹ หยุด</button>
          <button type="button" class="tts-all">📖 อ่านทั้งหน้า</button>
        </div>
        <div class="tts-hint"></div>
      </div>`;
    document.body.appendChild(bar);
    el.bar = bar;
    el.status = bar.querySelector('.tts-status');
    el.hint = bar.querySelector('.tts-hint');
    el.selTh = bar.querySelector('.tts-vth');
    el.selEn = bar.querySelector('.tts-ven');
    el.selRate = bar.querySelector('.tts-rate');
    el.pauseBtn = bar.querySelector('.tts-pause');
    bar.querySelector('.tts-fold').addEventListener('click', () => bar.classList.toggle('min'));
    el.pauseBtn.addEventListener('click', togglePause);
    bar.querySelector('.tts-stop').addEventListener('click', stopAll);
    bar.querySelector('.tts-all').addEventListener('click', () => {
      const inner = document.querySelector('main');
      if (state.playing && state.target === inner) stopAll();
      else startRead(inner, 'ทั้งหน้า');
    });
    el.selRate.value = String(state.rate);
    el.selRate.addEventListener('change', () => {
      state.rate = parseFloat(el.selRate.value) || 1;
      savePrefs();
      /* ถ้ากำลังอ่านอยู่ รีสตาร์ตท่อนปัจจุบันเพื่อให้ความเร็วใหม่มีผลทันที */
      if (state.playing && !state.paused) { const t = state.target, l = state.label; startRead(t, l); }
    });
    el.selTh.addEventListener('change', () => savePrefs());
    el.selEn.addEventListener('change', () => savePrefs());
  }

  /* ---------- เริ่มทำงาน ---------- */
  loadPrefs();
  buildBar();
  injectButtons();
  refreshVoices();
  if (typeof speechSynthesis.addEventListener === 'function') {
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  } else {
    speechSynthesis.onvoiceschanged = refreshVoices;
  }
  /* เสียงบางเครื่องมาช้า — ลองโหลดซ้ำช่วงแรก */
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    if (allVoices().length || tries > 10) clearInterval(t);
    else refreshVoices();
  }, 400);
  window.addEventListener('beforeunload', () => { stopAudio(); speechSynthesis.cancel(); });
})();
