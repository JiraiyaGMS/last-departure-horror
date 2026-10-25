// Thin DOM layer. The game calls into this; it never calls back into the game
// except through the callbacks it is handed.

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      clock: $('clocktime'),
      ampm: $('clockampm'),
      loop: $('loopcount'),
      reticle: $('reticle'),
      prompt: $('prompt'),
      subtitle: $('subtitle'),
      breath: $('breath'),
      breathFill: $('breathfill'),
      breathLabel: $('breathlabel'),
      inventory: $('inventory'),
      toast: $('toast'),
      keyHint: $('keyhint'),
      overlay: $('title'),
      notebook: $('notebook'),
      notebookBody: $('notebookbody'),
      notebookHint: $('notebookhint'),
      fade: $('fade'),
      startBtn: $('startbtn'),
      newBtn: $('newbtn'),
      loadFill: $('loadfill'),
      loadBar: $('loadbar'),
      pause: $('pause'),
      settings: $('settings'),
      controls: $('controls'),
    };

    this.reader = document.createElement('div');
    this.reader.id = 'reader';
    this.reader.className = 'hidden';
    this.reader.innerHTML = `<div id="readerinner" role="dialog" aria-modal="true">
      <h3></h3><div class="line"></div><div class="choices"></div>
      <div class="hint"></div></div>`;
    document.body.appendChild(this.reader);
    this.readerInner = this.reader.querySelector('#readerinner');
    this.readerTitle = this.reader.querySelector('h3');
    this.readerLines = this.reader.querySelector('.line');
    this.readerChoices = this.reader.querySelector('.choices');
    this.readerHint = this.reader.querySelector('.hint');

    this.ending = document.createElement('div');
    this.ending.id = 'ending';
    this.ending.className = 'hidden';
    this.ending.innerHTML = `<div class="endinginner">
      <div class="kind"></div><h1></h1><div class="lines"></div>
      <div class="seen"></div><button id="endbtn" class="menubtn primary">CONTINUE</button></div>`;
    document.body.appendChild(this.ending);

    // A letter lock: dials to turn, and a handle to try.
    this.dials = document.createElement('div');
    this.dials.id = 'dials';
    this.dials.className = 'hidden';
    this.dials.innerHTML = `<div class="dialsinner" role="dialog" aria-modal="true">
      <h3></h3><p class="text"></p><div class="wheels"></div>
      <nav class="dialnav"><button class="menubtn primary try">TRY THE HANDLE</button><button class="menubtn away">WALK AWAY</button></nav>
      <div class="hint"></div></div>`;
    document.body.appendChild(this.dials);
    this.dialsOpen = false;

    this.subtitleTimer = 0;
    this.toastTimer = 0;
    this.notebookOpen = false;
    this.readerOpen = false;
    this.endingOpen = false;
    this.pauseOpen = false;
    this.cache = {};
  }

  get modalOpen() {
    return this.readerOpen || this.notebookOpen || this.endingOpen || this.pauseOpen || this.dialsOpen;
  }

  // Writes only when the value changed: these are called every frame, and
  // innerHTML every frame was a layout per frame for nothing.
  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  showHUD(on) {
    this.el.hud.classList.toggle('live', on);
  }

  setClock(label) {
    const [time, ampm] = label.split(' ');
    this.set('clock', this.el.clock, time);
    this.set('ampm', this.el.ampm, ampm ?? '');
  }

  setLoop(n) {
    this.set('loop', this.el.loop, `LOOP ${n}`);
  }

  // Prompts are written with keycaps, `<kbd>E</kbd> Take coin`. On a tablet
  // they name the on-screen buttons instead of keys.
  setPrompt(html) {
    html = html || '';
    if (this.pad) {
      html = html
        .replace(/<kbd>A<\/kbd> <kbd>D<\/kbd>/g, '<kbd>&#9664;</kbd> <kbd>&#9654;</kbd>')
        .replace(/<kbd>SPACE<\/kbd>/g, '<kbd>LT</kbd>')
        .replace(/<kbd>Q<\/kbd>/g, '<kbd>B</kbd>')
        .replace(/<kbd>R<\/kbd>/g, '<kbd>Y</kbd>')
        .replace(/<kbd>SCROLL<\/kbd>/g, '<kbd>Y</kbd>')
        .replace(/<kbd>E<\/kbd>/g, '<kbd>A</kbd>')
        .replace(/<kbd>1<\/kbd>/g, '<kbd>&#9664;</kbd>')
        .replace(/<kbd>2<\/kbd>/g, '<kbd>&#9654;</kbd>');
    } else if (this.touch) {
      html = html
        .replace(/<kbd>SPACE<\/kbd> hold breath/g, '<kbd>HOLD BREATH</kbd>')
        .replace(/<kbd>Q<\/kbd> leave/g, '<kbd>LEAVE</kbd>')
        .replace(/<kbd>R<\/kbd> Answer/g, '<kbd>ANSWER</kbd>')
        .replace(/<kbd>E<\/kbd>/g, '<kbd>USE</kbd>')
        .replace(/<kbd>SPACE<\/kbd>/g, '<kbd>HOLD BREATH</kbd>')
        .replace(/<kbd>Q<\/kbd>/g, '<kbd>LEAVE</kbd>')
        .replace(/<kbd>R<\/kbd>/g, '<kbd>ANSWER</kbd>');
    }
    if (html === this.cache.prompt) return;
    this.cache.prompt = html;
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.toggle('show', !!html);
  }

  setReticle(state) {
    this.set('reticle', this.el.reticle, `reticle-${state}`, 'className');
  }

  // `priority` 0 is background chatter: a passenger muttering, a voice half
  // heard. It never replaces a line that is still up and says something the
  // player needs, like why they were just found.
  subtitle(text, duration = 3.5, thought = false, priority = 1) {
    if (priority < (this.subtitlePriority ?? 0) && this.subtitleTimer > 0.4) return false;
    this.subtitlePriority = priority;
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.add('show');
    this.el.subtitle.classList.toggle('thought', thought);
    this.subtitleTimer = duration;
  }

  // What you think rather than what you hear: set in italics.
  narrate(text, duration = 4) {
    this.subtitle(text, duration, true);
  }

  toast(text, duration = 3) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('show');
    // Restart the entrance animation for back-to-back toasts.
    void this.el.toast.offsetWidth;
    this.el.toast.classList.add('show');
    this.toastTimer = duration;
  }

  // The keys, once, in the corner, the first night: `html` is kbd markup.
  keyHint(html, seconds = 14) {
    const el = this.el.keyHint;
    el.innerHTML = html;
    el.classList.add('show');
    // Counted in tick(), and only while nothing is open over the game.
    this.keyHintTimer = seconds;
  }

  setBreath(value, show, holding = false) {
    const v = Math.max(0, Math.min(1, value));
    this.el.breath.classList.toggle('show', show);
    if (!show) return;
    this.el.breathFill.style.transform = `scaleX(${v.toFixed(3)})`;
    this.el.breath.classList.toggle('low', v < 0.3);
    this.set('breathLabel', this.el.breathLabel, holding ? 'HOLDING BREATH' : 'BREATH');
  }

  // `m` is a plain description of what the player is carrying; this decides
  // how it looks.
  setInventory(m) {
    const pill = (on, label) => `<span class="pill${on ? ' on' : ''}">${label}</span>`;
    const rows = [];
    rows.push(`<div class="row ticket"><span class="lbl">TICKET</span>${pill(m.ticket[0], 'STUB')}${pill(m.ticket[1], 'STAMP')}${pill(m.ticket[2], 'TRANSFER')}</div>`);
    rows.push(`<div class="row"><span class="lbl">COINS</span><span class="val${m.coins ? '' : ' dim'}">${m.coins}<small>/4</small></span>${m.coins ? `<span class="hint">${this.pad ? 'LB' : this.touch ? 'COIN' : 'G'} throw</span>` : ''}</div>`);
    if (m.torch) {
      const segs = 10;
      const lit = Math.ceil(m.torch.pct / (100 / segs));
      let bar = '';
      for (let i = 0; i < segs; i++) bar += `<i class="${i < lit ? 'on' : ''}"></i>`;
      rows.push(`<div class="row torch${m.torch.low ? ' warn' : ''}${m.torch.on ? ' lit' : ''}"><span class="lbl">TORCH</span><span class="battery">${bar}</span><span class="val small">${m.torch.cells} CELL${m.torch.cells === 1 ? '' : 'S'}</span>${m.torch.canSwap ? `<span class="hint">${this.pad ? 'RB' : this.touch ? 'CELL' : 'B'}</span>` : ''}</div>`);
    }
    const items = [];
    if (m.keyring) items.push('KEYRING');
    if (m.punch) items.push('PUNCH');
    if (m.walkie) items.push('WALKIE');
    if (items.length) rows.push(`<div class="row items">${items.map((i) => `<span class="tag">${i}</span>`).join('')}</div>`);
    if (m.carrying) rows.push(`<div class="row carry"><span class="lbl">CARRYING</span><span class="val">${esc(m.carrying)}</span></div>`);
    rows.push(`<div class="row heard"><span class="lbl">HEARD</span><span class="val dim">${m.heard}<small>/${m.total}</small></span></div>`);
    this.set('inv', this.el.inventory, rows.join(''), 'innerHTML');
  }

  tick(dt) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el.subtitle.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
    if (this.keyHintTimer > 0 && !this.modalOpen) {
      this.keyHintTimer -= dt;
      if (this.keyHintTimer <= 0) this.el.keyHint.classList.remove('show');
    }
  }

  // `choices` is an optional array of { label, own, onPick }.
  // opts.style: 'paper' for documents, 'panel' for everything else.
  showDocument(title, lines, choices = null, onClose = null, opts = {}) {
    const style = opts.style ?? (choices && choices.length ? 'panel' : 'paper');
    this.readerInner.className = `style-${style}`;
    this.readerTitle.textContent = title;
    this.readerLines.textContent = lines.join('\n');
    this.readerChoices.innerHTML = '';
    this.onReaderClose = onClose;

    if (choices && choices.length) {
      this.readerHint.textContent = this.pad ? 'D-pad and A to choose  ·  B to walk away' : this.touch ? 'Tap a choice' : 'Choose one  ·  ESC to walk away';
      choices.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'choice' + (c.own ? ' own' : '');
        btn.innerHTML = `<span class="num">${i + 1}</span><span>${esc(c.label)}</span>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pick(i);
        });
        this.readerChoices.appendChild(btn);
      });
      this.choices = choices;
    } else {
      this.choices = null;
      this.readerHint.textContent = this.pad ? 'A or B to close' : this.touch ? 'Tap to close' : 'E or ESC to close';
    }

    this.reader.classList.remove('hidden');
    this.reader.scrollTop = 0;
    this.readerOpen = true;
    this.hasChoices = !!(choices && choices.length);
  }

  // Number keys pick from a list of choices, as well as the mouse.
  pick(i) {
    const c = this.choices?.[i];
    if (!c) return false;
    const cb = this.onReaderClose;
    this.closeDocument(true);
    c.onPick?.();
    // Back to the game the same way closing would have -- unless the choice
    // opened something else, or ended the night.
    cb?.();
    return true;
  }

  closeDocument(skipCallback = false) {
    if (!this.readerOpen) return;
    this.reader.classList.add('hidden');
    this.readerOpen = false;
    this.hasChoices = false;
    this.choices = null;
    const cb = this.onReaderClose;
    this.onReaderClose = null;
    if (!skipCallback) cb?.();
  }

  // `plan` is objectives() (objectives.js): tonight's checklist, shown above
  // everything written down so far.
  // ---- letter dials ---------------------------------------------------------

  // opts: { title, text, start: 'ABCD', onTurn(), onTry(word) -> true when it
  // opens, onClose() }.
  showDials(opts) {
    const el = this.dials;
    this.dialOpts = opts;
    this.dialWord = opts.start.split('');
    this.dialFocus = 0;
    el.querySelector('h3').textContent = opts.title;
    el.querySelector('.text').textContent = opts.text;
    el.querySelector('.hint').innerHTML = this.pad
      ? '<kbd>D-pad</kbd> choose and turn the dials  &middot;  <kbd>A</kbd> try the handle  &middot;  <kbd>B</kbd> walk away'
      : this.touch
      ? 'Tap the arrows to turn a dial'
      : '<kbd>&larr;</kbd><kbd>&rarr;</kbd> choose a dial  &middot;  <kbd>&uarr;</kbd><kbd>&darr;</kbd> or type a letter  &middot;  <kbd>Enter</kbd> try  &middot;  <kbd>Esc</kbd> walk away';
    const wheels = el.querySelector('.wheels');
    wheels.innerHTML = '';
    this.dialEls = this.dialWord.map((_, i) => {
      const w = document.createElement('div');
      w.className = 'wheel';
      w.innerHTML = `<button class="up" aria-label="Turn dial ${i + 1} up">&#9650;</button>
        <div class="face"><span class="prev"></span><span class="cur"></span><span class="next"></span></div>
        <button class="down" aria-label="Turn dial ${i + 1} down">&#9660;</button>`;
      w.querySelector('.up').addEventListener('click', (e) => { e.stopPropagation(); this.turnDial(i, -1); });
      w.querySelector('.down').addEventListener('click', (e) => { e.stopPropagation(); this.turnDial(i, 1); });
      w.querySelector('.face').addEventListener('click', () => { this.dialFocus = i; this.drawDials(); });
      wheels.appendChild(w);
      return w;
    });
    el.querySelector('.try').onclick = () => this.tryDials();
    el.querySelector('.away').onclick = () => this.closeDials();
    el.classList.remove('hidden', 'wrong', 'open');
    this.dialsOpen = true;
    this.drawDials();
  }

  drawDials() {
    const L = (c, d) => String.fromCharCode(65 + ((c.charCodeAt(0) - 65 + d + 26) % 26));
    this.dialEls.forEach((w, i) => {
      const c = this.dialWord[i];
      w.querySelector('.prev').textContent = L(c, -1);
      w.querySelector('.cur').textContent = c;
      w.querySelector('.next').textContent = L(c, 1);
      w.classList.toggle('focus', i === this.dialFocus);
    });
  }

  turnDial(i, d) {
    const c = this.dialWord[i].charCodeAt(0) - 65;
    this.dialWord[i] = String.fromCharCode(65 + ((c + d + 26) % 26));
    this.dialFocus = i;
    this.dials.classList.remove('wrong');
    this.dialOpts.onTurn?.();
    this.drawDials();
  }

  setDial(i, letter) {
    this.dialWord[i] = letter;
    this.dialFocus = Math.min(this.dialWord.length - 1, i + 1);
    this.dials.classList.remove('wrong');
    this.dialOpts.onTurn?.();
    this.drawDials();
  }

  tryDials() {
    const word = this.dialWord.join('');
    this.dialOpts.lastWord = word;
    if (this.dialOpts.onTry(word)) {
      this.dials.classList.add('open');
      this.closeDials();
      return;
    }
    // Restart the shake.
    this.dials.classList.remove('wrong');
    void this.dials.offsetWidth;
    this.dials.classList.add('wrong');
  }

  // Keys while the dials are up. Returns true if the key was theirs.
  dialKey(code, key) {
    if (!this.dialsOpen) return false;
    const n = this.dialWord.length;
    if (code === 'ArrowLeft') {
      this.dialFocus = (this.dialFocus + n - 1) % n;
      this.drawDials();
    } else if (code === 'ArrowRight') {
      this.dialFocus = (this.dialFocus + 1) % n;
      this.drawDials();
    } else if (code === 'ArrowUp') {
      this.turnDial(this.dialFocus, -1);
    } else if (code === 'ArrowDown') {
      this.turnDial(this.dialFocus, 1);
    } else if (code === 'Backspace') {
      this.dialFocus = (this.dialFocus + n - 1) % n;
      this.drawDials();
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      this.tryDials();
    } else if (code === 'Escape') {
      this.closeDials();
    } else if (/^[a-z]$/i.test(key ?? '')) {
      this.setDial(this.dialFocus, key.toUpperCase());
    } else {
      return false;
    }
    return true;
  }

  closeDials() {
    if (!this.dialsOpen) return;
    this.dials.classList.add('hidden');
    this.dialsOpen = false;
    const cb = this.dialOpts?.onClose;
    this.dialOpts = null;
    cb?.();
  }

  toggleNotebook(notes, plan = null) {
    if (this.notebookOpen) {
      this.closeNotebook();
      return false;
    }
    const byCategory = new Map();
    for (const note of notes) {
      if (!byCategory.has(note.category)) byCategory.set(note.category, []);
      byCategory.get(note.category).push(note);
    }
    let html = plan ? this.planHTML(plan) : '';
    if (!notes.length) {
      html = '<p class="entry empty">Nothing written down yet. The station has not told you anything.</p>';
    }
    for (const [category, items] of byCategory) {
      html += `<section><h4>${esc(category)}</h4>`;
      for (const item of items) {
        html += `<p class="entry"><span class="loopmark">${item.loop}</span>${esc(item.text)}</p>`;
      }
      html += '</section>';
    }
    this.el.notebookBody.innerHTML = html;
    this.el.notebookHint.textContent = this.pad ? 'B to close' : this.touch ? 'Tap to close' : 'TAB to close';
    this.el.notebook.classList.remove('hidden');
    this.el.notebookBody.scrollTop = 0;
    this.notebookOpen = true;
    return true;
  }

  planHTML(plan) {
    const line = (l) => `<li class="${l.done ? 'done' : 'todo'}"><span class="box"></span><span class="t">${esc(l.text)}${l.hint ? `<span class="h">${esc(l.hint)}</span>` : ''}</span></li>`;
    let html = '<div class="tonight"><h4>TONIGHT</h4><ul>';
    html += plan.ticket.map(line).join('') + line(plan.board);
    html += '</ul>';
    for (const n of plan.now) html += `<p class="now">${esc(n)}</p>`;
    if (plan.more.length) html += `<h4>AND</h4><ul>${plan.more.map(line).join('')}</ul>`;
    return html + '</div>';
  }

  closeNotebook() {
    this.el.notebook.classList.add('hidden');
    this.notebookOpen = false;
  }

  fade(on, instant = false) {
    this.el.fade.classList.toggle('instant', instant);
    this.el.fade.classList.toggle('on', on);
    if (instant) {
      // Force a reflow so the next transition applies.
      void this.el.fade.offsetWidth;
      this.el.fade.classList.remove('instant');
    }
  }

  // The ending card sits above the fade, so the fade can stay down behind it
  // and come up on the next night without a flash of the station between.
  showEnding(ending, seenIds, allEndings, onContinue) {
    this.ending.querySelector('h1').textContent = ending.title;
    this.ending.querySelector('.kind').textContent = ending.kind.toUpperCase() + ' ENDING';
    const lines = this.ending.querySelector('.lines');
    lines.innerHTML = '';
    let delay = 0.6;
    for (const line of ending.lines) {
      const p = document.createElement('p');
      p.textContent = line || ' ';
      p.style.animationDelay = `${delay.toFixed(2)}s`;
      delay += line ? 0.55 : 0.25;
      lines.appendChild(p);
    }
    const seen = this.ending.querySelector('.seen');
    seen.innerHTML = `<div class="seenlbl">ENDINGS FOUND ${seenIds.length} / ${allEndings.length}</div>`
      + `<div class="slots">${allEndings.map((e) => `<span class="slot${seenIds.includes(e.id) ? ' on' : ''}">${seenIds.includes(e.id) ? esc(e.title) : '?'}</span>`).join('')}</div>`;
    seen.style.animationDelay = `${(delay + 0.3).toFixed(2)}s`;
    const btn = this.ending.querySelector('#endbtn');
    btn.style.animationDelay = `${(delay + 0.6).toFixed(2)}s`;
    this.ending.classList.remove('hidden');
    this.ending.scrollTop = 0;
    this.endingOpen = true;
    btn.onclick = () => {
      this.ending.classList.add('hidden');
      this.endingOpen = false;
      onContinue?.();
    };
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }

  setLoading(done, total) {
    const ready = total > 0 && done >= total;
    this.el.loadFill.style.transform = `scaleX(${total ? (done / total).toFixed(3) : 0})`;
    this.el.loadBar.classList.toggle('done', ready);
    return ready;
  }

  // ---- pause and its sub-screens ------------------------------------------

  showScreen(name) {
    for (const key of ['pause', 'settings', 'controls']) {
      this.el[key].classList.toggle('hidden', key !== name);
    }
  }

  openPause() {
    this.pauseOpen = true;
    this.showScreen('pause');
  }

  closePause() {
    this.pauseOpen = false;
    this.showScreen(null);
  }
}
