// Thin DOM layer. The game calls into this; it never calls back into the game
// except through the callbacks handed to showDocument.

export class HUD {
  constructor() {
    this.el = {
      clock: document.getElementById('clock'),
      loop: document.getElementById('loopcount'),
      prompt: document.getElementById('prompt'),
      subtitle: document.getElementById('subtitle'),
      breath: document.getElementById('breath'),
      breathFill: document.getElementById('breathfill'),
      inventory: document.getElementById('inventory'),
      toast: document.getElementById('toast'),
      overlay: document.getElementById('overlay'),
      notebook: document.getElementById('notebook'),
      notebookBody: document.getElementById('notebookbody'),
      fade: document.getElementById('fade'),
      startBtn: document.getElementById('startbtn'),
    };

    this.reader = document.createElement('div');
    this.reader.id = 'reader';
    this.reader.className = 'hidden';
    this.reader.innerHTML = `<div id="readerinner">
      <h3></h3><div class="line"></div><div class="choices"></div>
      <div class="hint"></div></div>`;
    document.body.appendChild(this.reader);
    this.readerTitle = this.reader.querySelector('h3');
    this.readerLines = this.reader.querySelector('.line');
    this.readerChoices = this.reader.querySelector('.choices');
    this.readerHint = this.reader.querySelector('.hint');

    this.ending = document.createElement('div');
    this.ending.id = 'ending';
    this.ending.className = 'hidden';
    this.ending.innerHTML = `<h1></h1><div class="kind"></div><div class="lines"></div>
      <div class="seen"></div><button id="endbtn">CONTINUE</button>`;
    document.body.appendChild(this.ending);

    this.subtitleTimer = 0;
    this.toastTimer = 0;
    this.notebookOpen = false;
    this.readerOpen = false;
    this.endingOpen = false;
  }

  get modalOpen() {
    return this.readerOpen || this.notebookOpen || this.endingOpen;
  }

  setClock(label) {
    this.el.clock.textContent = label;
  }

  setLoop(n) {
    this.el.loop.textContent = `LOOP ${n}`;
  }

  setPrompt(html) {
    html = html || '';
    // On a tablet the prompts name the on-screen buttons instead of keys.
    if (this.touch) {
      html = html.replace('[E]', '[USE]').replace('[SPACE]', '[HOLD BREATH]').replace('[Q]', '[LEAVE]');
    }
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    this.el.prompt.innerHTML = html;
  }

  subtitle(text, duration = 3.5) {
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.add('show');
    this.subtitleTimer = duration;
  }

  toast(text, duration = 3) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = duration;
  }

  setBreath(value, show) {
    this.el.breath.classList.toggle('show', show);
    this.el.breathFill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    this.el.breathFill.style.background = value < 0.3 ? '#ff6b6b' : '#6bffb0';
  }

  setInventory(lines) {
    this.el.inventory.innerHTML = lines.join('<br>');
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
  }

  // `choices` is an optional array of { label, own, onPick }.
  showDocument(title, lines, choices = null, onClose = null) {
    this.readerTitle.textContent = title;
    this.readerLines.textContent = lines.join('\n');
    this.readerChoices.innerHTML = '';
    this.onReaderClose = onClose;

    if (choices && choices.length) {
      this.readerHint.textContent = 'Choose one';
      for (const c of choices) {
        const btn = document.createElement('button');
        btn.className = 'choice' + (c.own ? ' own' : '');
        btn.textContent = c.label;
        btn.addEventListener('click', () => {
          this.closeDocument(true);
          c.onPick?.();
        });
        this.readerChoices.appendChild(btn);
      }
    } else {
      this.readerHint.textContent = this.touch ? 'Tap to close' : 'E or ESC to close';
    }

    this.reader.classList.remove('hidden');
    this.readerOpen = true;
    this.hasChoices = !!(choices && choices.length);
  }

  closeDocument(skipCallback = false) {
    if (!this.readerOpen) return;
    this.reader.classList.add('hidden');
    this.readerOpen = false;
    this.hasChoices = false;
    if (!skipCallback) this.onReaderClose?.();
    this.onReaderClose = null;
  }

  toggleNotebook(notes) {
    if (this.notebookOpen) {
      this.el.notebook.classList.add('hidden');
      this.notebookOpen = false;
      return false;
    }
    const byCategory = new Map();
    for (const note of notes) {
      if (!byCategory.has(note.category)) byCategory.set(note.category, []);
      byCategory.get(note.category).push(note);
    }
    let html = '';
    if (!notes.length) {
      html = '<p class="entry">Nothing written down yet. The station has not told you anything.</p>';
    }
    for (const [category, items] of byCategory) {
      html += `<h4>${category.toUpperCase()}</h4>`;
      for (const item of items) {
        html += `<p class="entry">${item.text}</p>`;
      }
    }
    this.el.notebookBody.innerHTML = html;
    this.el.notebook.classList.remove('hidden');
    this.notebookOpen = true;
    return true;
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

  showEnding(ending, seenCount, totalEndings, onContinue) {
    this.ending.querySelector('h1').textContent = ending.title;
    this.ending.querySelector('.kind').textContent = ending.kind.toUpperCase() + ' ENDING';
    this.ending.querySelector('.lines').textContent = ending.lines.join('\n');
    this.ending.querySelector('.seen').textContent =
      `ENDINGS FOUND ${seenCount} / ${totalEndings}`;
    this.ending.classList.remove('hidden');
    this.endingOpen = true;
    const btn = this.ending.querySelector('#endbtn');
    btn.onclick = () => {
      this.ending.classList.add('hidden');
      this.endingOpen = false;
      onContinue?.();
    };
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }
}
