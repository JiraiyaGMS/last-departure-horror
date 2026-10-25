import * as THREE from 'three';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/caveat/latin-500.css';
import '@fontsource/caveat/latin-600.css';
import { Level, roomAt, ROOMS } from './level.js';
import { furnish } from './furnish.js';
import { Player } from './player.js';
import { Attendant } from './attendant.js';
import { Echoes } from './echoes.js';
import { Throwables } from './throwables.js';
import { LoopClock } from './loop.js';
import { RuleEngine } from './rules.js';
import { Fear } from './fear.js';
import { Director } from './director.js';
import { Presence } from './presence.js';
import { GameState } from './state.js';
import { AudioEngine } from './audio.js';
import { Ambience } from './ambience.js';
import { RenderPipeline, DESIGN_ASPECT, makeStationEnvironment } from './render.js';
import { CCTV } from './cctv.js';
import { People } from './people.js';
import { Models } from './models.js';
import { Sets } from './sets.js';
import { Cutscene } from './cutscene.js';
import { wakeScene, ENDING_SCENES } from './scenes.js';
import { setAnisotropy, setBigTextures, applyMetricUVs, onTextureProgress, texturesReady } from './textures.js';
import { Quality } from './quality.js';
import { Settings, TEXT_SCALES, DIFFICULTY, brightnessGamma } from './settings.js';
import { Atmosphere } from './atmosphere.js';
import { HUD } from './ui/hud.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { Gamepads } from './ui/gamepad.js';
import { segmentBlocked, sightBlockedTo } from './collision.js';
import { objectives, nextStep } from './objectives.js';
import { BOARD_ROUTES, PA_LINES, ENDINGS, PASSENGERS, theItem } from './content.js';

const SPAWN = { x: -3.2, z: 6, yaw: 0 };

// Scratch vectors for the per-frame queries, so aiming at things does not
// allocate eighty vectors a frame.
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

class Game {
  constructor() {
    this.hud = new HUD();
    this.state = new GameState();
    this.settings = new Settings();
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    this.ambience = new Ambience(this);
    this.clock = new LoopClock();
    this.rules = new RuleEngine(this);
    this.fear = new Fear();
    this.playerName = 'PASSENGER';

    this.carrying = null;
    this.boardStare = 0;
    this.boardRevealed = false;
    this.boardingCalled = false;
    this.mirrorRevealing = false;
    this.inDark = false;
    this.answeredPA = false;
    this.toldWrongTime = false;
    this.challenge = null;
    this.timeChallenge = null;
    this.cameraViews = [];
    this.boardRows = this.baseBoardRows();
    this.ruleSignRows = [];
    this.transitioning = false;
    this.started = false;
    this.ended = false;
    this.huntIntensity = 0;

    // Game time, which stops while the game is paused or a document is open.
    // Everything scheduled in the world runs on this rather than on
    // setTimeout, so nothing fires behind a menu or bleeds into the next night.
    this.simTime = 0;
    this.timers = [];
    this.jukeboxUntil = -1;
    this.blackoutHold = 0;

    this.quality = new Quality();
    this.initRenderer();
    this.initWorld();
    this.initEvents();
    this.initInput();
    this.initMenus();

    this.refreshSign();
    this.hud.setLoop(this.state.persistent.loop);
    this.lastFrame = performance.now();
    this.animate();
  }

  // ---- setup -------------------------------------------------------------

  initRenderer() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // The composer renders into its own buffers, so canvas MSAA would only
      // antialias the final full-screen copy. Antialiasing lives on the
      // composer's targets instead, on the tiers that can afford it.
      antialias: false,
      powerPreference: 'high-performance',
    });
    // Resolution is owned by the quality governor: native up to a per-tier
    // cap, scaled down on the fly if the device cannot hold the frame rate.
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setClearColor(0x05080a, 1);

    // Must happen before the first surface is requested, so the initial load
    // fetches the right resolution.
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    setAnisotropy(Math.min(this.quality.tier.anisotropy, this.maxAnisotropy));
    setBigTextures(this.quality.tier.bigTextures);

    this.scene = new THREE.Scene();
    // Exponential fog holds depth far better than linear in a corridor, and
    // keeps the far end of the hall genuinely unreadable rather than merely
    // tinted.
    this.scene.fog = new THREE.FogExp2(0x070b0b, 0.038);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, DESIGN_ASPECT, 0.05, 160);
    this.scene.add(this.camera);

    // Flat ambient is kept to a sliver, purely as a floor under absolute black.
    this.ambient = new THREE.AmbientLight(0x1a2a26, 0.18);
    this.scene.add(this.ambient);

    // The fill light proper. A hemisphere approximates the one bounce that
    // matters indoors: fluorescent light off a white ceiling coming down, and
    // almost nothing coming back up off dirty vinyl.
    this.hemi = new THREE.HemisphereLight(0x4a6f64, 0x0b1210, 1.5);
    this.scene.add(this.hemi);

    this.ps1 = new RenderPipeline(this.renderer, this.scene, this.camera, { tier: this.quality.tier });
    this.ps1.setGamma(brightnessGamma(this.settings.brightness));

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // The GPU can be taken away -- a driver reset, a laptop waking from
    // sleep. three.js puts its own state back when it returns; until then
    // the game holds still behind the pause screen rather than running on
    // blind.
    this.canvas.addEventListener('webglcontextlost', () => {
      this.contextLost = true;
      if (this.started) this.pause();
      this.toast('The graphics were reset. Waiting for them to come back...');
      clearTimeout(this.contextTimer);
      this.contextTimer = setTimeout(() => {
        if (this.contextLost) this.toast('The graphics have not come back. Reload the page: your notebook is saved.');
      }, 4000);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.ps1.invalidateShadows();
      this.toast('The graphics are back.');
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.quality.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.ps1?.setSize(w, h, pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.presence?.resizeFace();
  }

  initWorld() {
    // The cast downloads alongside the textures; figures are dressed as soon
    // as it lands, and BEGIN waits for it with everything else.
    this.people = new People();
    this.people.load();
    this.models = new Models();
    this.models.load();
    // A prop arriving puts something new in every cached shadow map; one
    // redraw per frame however many land at once.
    this.models.onAdded = () => {
      if (this.shadowRedrawQueued) return;
      this.shadowRedrawQueued = true;
      requestAnimationFrame(() => {
        this.shadowRedrawQueued = false;
        this.ps1.invalidateShadows();
      });
    };
    this.level = new Level();
    this.level.buildShell();
    this.refs = furnish(this.level, this);
    // Every photo-textured surface gets UVs in metres, so a floor tile is the
    // same size in every room and nothing stretches along a long wall.
    applyMetricUVs(this.level.group);
    this.scene.add(this.level.group);
    // Opening a door changes the shape of the room, so the cached shadows of
    // the lights around it have to be redrawn.
    this.level.onGeometryChange = () => this.ps1.invalidateShadows();
    this.setupShadowCasting();

    this.player = new Player(this.camera, this.level, this);
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.player.flashlight.shadow.mapSize.set(this.quality.tier.flashShadowSize, this.quality.tier.flashShadowSize);

    this.atmosphere = new Atmosphere(this, this.quality.tier);

    this.attendant = new Attendant(this.level, this);
    this.echoes = new Echoes(this.level, this);
    this.throwables = new Throwables(this.level, this);
    this.presence = new Presence(this);
    this.director = new Director(this);
    this.cctv = new CCTV(this);
    // The cutscenes' stage: the coach's cabin, the road, their own lamps.
    this.sets = new Sets(this);

    // Reflections for the few surfaces that need something to reflect.
    try {
      const env = makeStationEnvironment(this.renderer);
      const shiny = [...this.level.materials.filter((m) => m.userData.env), this.throwables.mat];
      for (const m of shiny) {
        m.envMap = env;
        m.envMapIntensity = (m.userData.env ?? 1) * 0.6;
        m.needsUpdate = true;
      }
      this.models.setEnvironment(env);
    } catch (e) {
      console.warn('environment map unavailable', e);
    }

    // The canvases were first painted before the typefaces had loaded.
    if (document.fonts?.load) {
      Promise.all([
        '500 20px "Barlow Condensed"', '600 20px "Barlow Condensed"', '700 20px "Barlow Condensed"',
        '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"', '600 20px "IBM Plex Mono"',
        '500 20px "Caveat"', '600 20px "Caveat"',
      ].map((f) => document.fonts.load(f).catch(() => null)))
        .then(() => this.refs.redrawAll?.());
    }
  }

  // One traversal rather than a flag on every call site in furnish.js. The
  // only things excluded are the light sources themselves -- a glowing tube
  // that casts a shadow of its own housing looks broken -- and anything
  // already marked as not wanting them.
  setupShadowCasting() {
    this.level.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.noShadow) return;
      const m = o.material;
      // Emissive panels, screens and the tubes are sources, not occluders.
      const isSource = m && m.isMeshBasicMaterial;
      // Glass and other see-through things neither stop light nor take it.
      const clear = m && m.transparent;
      o.castShadow = !isSource && !clear;
      o.receiveShadow = !isSource && !clear;
    });
    this.ps1.registerShadowLights(this.level.lights);
  }

  initEvents() {
    this.clock
      .on('00:30', 'jukebox', () => {
        // Four seconds of total silence first. The hum has been under every
        // moment of the game so far; taking it away is louder than any sound.
        this.fear.claim(10);
        this.audio.cutHum(4);
        this.fear.wantTension(0.8);
        this.subtitle('The hum stops.', 2.5);
        this.later(3.8, () => {
          this.subtitle('The jukebox starts playing by itself.', 4);
          if (this.jukeEmitter) {
            const length = this.audio.playJukebox(this.jukeEmitter, 1);
            this.jukeboxUntil = this.simTime + length;
          }
          this.fear.jolt(0.5);
          this.note('Schedule', '12:30 — the jukebox starts on its own.');
        });
      })
      .on('00:10', 'pa_name_1', () => this.callPlayerName())
      .on('01:00', 'baggage_dark', () => this.baggageBlackout())
      .on('01:40', 'pa_lie', () => {
        this.pa(PA_LINES.lies[Math.floor(Math.random() * PA_LINES.lies.length)]);
      })
      .on('02:00', 'mirror', () => {
        this.fear.claim(8);
        this.mirrorRevealing = true;
        this.audio.cutHum(1.0);
        // He is standing in the glass whether or not you are in the room to
        // see it, and the writing on the wall only shows up reversed.
        this.presence.mirrorHaunt(26, { at: 0.72, scale: 0.98, eyes: true, tilt: 0.42 });
        this.refs.mirror?.redraw();
        if (this.currentRoom === 'restroom') {
          this.fear.jolt(0.9);
          this.audio.stinger();
          this.subtitle('The mirror has someone else in it.', 4);
        }
        this.note('Schedule', '2:00 — the restroom mirror starts showing the wall behind it.');
      })
      .on('02:14', 'camera4', () => this.camera4Event())
      .on('02:40', 'pa_name_2', () => this.callPlayerName())
      .on('03:00', 'walter_waits', () => {
        this.fear.claim(6);
        this.pa('The last service of the night will depart Bay 9 at 3:33. All other bays are closed.');
        this.audio.cutHum(5);
        this.fear.wantTension(1);
        this.subtitle('The keys stop moving. He has gone to Bay 9 to wait.', 5);
        this.note('Schedule', '3:00 — the Attendant stops patrolling and waits at Bay 9.');
      })
      .on('03:25', 'doors_open', () => {
        this.fear.claim(4);
        this.audio.splitFlap(26, this.boardEmitter?.gain);
        this.fear.kick('aberration', 0.9);
        this.subtitle('The board clatters. BAY 9 — NOW BOARDING.', 5);
        this.boardingCalled = true;
        // If something has the board reading wrong just now, it will read
        // BOARDING when it lets go.
        if (!this.presence.boardWrong) this.boardRows = this.baseBoardRows();
        this.refs.board?.redraw();
      });
  }

  // The board as the timetable says it should read tonight.
  baseBoardRows() {
    return BOARD_ROUTES.map((r) => (this.boardingCalled && r.bay === 9 ? { ...r, status: 'BOARDING' } : { ...r }));
  }

  // The locker word, read off the real timetable: the first letters of the
  // cancelled services, in board order.
  lockerInitials() {
    return BOARD_ROUTES.filter((r) => r.status === 'CANCELLED').map((r) => r.dest[0]).join('');
  }

  // Schedules `fn` after `seconds` of game time.
  later(seconds, fn) {
    this.timers.push({ at: this.simTime + seconds, fn });
  }

  tickTimers(dt) {
    this.simTime += dt;
    if (!this.timers.length) return;
    const due = [];
    this.timers = this.timers.filter((t) => {
      if (t.at > this.simTime) return true;
      due.push(t);
      return false;
    });
    due.sort((a, b) => a.at - b.at);
    for (const t of due) {
      if (this.ended || this.transitioning) break;
      try {
        t.fn();
      } catch (e) {
        console.error(e);
      }
    }
  }

  jukeboxDeafens() {
    return this.simTime < this.jukeboxUntil;
  }

  // 1:00. Baggage Claim loses its lights -- and if you are standing in them
  // when it happens, you get the full treatment: black screen, no sound, and
  // then a face when it comes back.
  baggageBlackout() {
    const inside = this.currentRoom === 'baggage';
    this.fear.claim(inside ? 14 : 6);
    for (const light of this.level.lights) {
      if (light.room === 'baggage') light.broken = true;
    }
    this.audio.cutHum(inside ? 5 : 2.0);
    this.note('Schedule', '1:00 — the lights in Baggage Claim fail.');

    if (!inside) {
      this.subtitle('Somewhere behind you, a bank of lights goes out.', 4);
      this.fear.wantTension(0.7);
      return;
    }

    this.fear.kick('blackout', 1);
    this.fear.kick('static', 1);
    this.audio.deafen(3.2);
    this.subtitle('The lights go out on top of you.', 3);
    // Hold the dark. Nothing happens for long enough that the player starts
    // moving again, and then the face is already there.
    this.blackoutHold = 2.6;
    this.later(3.1, () => {
      this.presence.flashFace(4);
      this.fear.jolt(1);
    });
  }

  // 2:14. Every screen in the building agrees on something that is not in any
  // of the rooms they are pointed at.
  camera4Event() {
    this.fear.claim(12);
    this.camera4Active = true;
    this.audio.cutHum(4.5);
    this.fear.kick('static', 1);
    this.fear.kick('aberration', 1.6);
    this.fear.wantTension(1);
    this.subtitle('The hum stops. Every screen in the building flickers at once.', 4.5);
    this.note('Schedule', '2:14 — something appears on CCTV camera 4.');
    // It parks itself at a lens for a long time, and it does not leave when
    // you stop watching.
    this.presence.cctvHaunt(70);
    this.cameraViews = this.describeCameras();
    this.refs.monitors?.redraw();
    this.later(5.2, () => {
      if (this.currentRoom === 'cctv') {
        this.fear.jolt(1);
        this.audio.stinger();
        this.presence.flashFace(3);
        this.subtitle('It is closer to the lens than it was a second ago.', 4);
      }
    });
  }

  initInput() {
    if (isTouchDevice()) {
      this.hud.touch = true;
      this.touch = new TouchControls(this);
      this.hud.el.notebookHint.textContent = 'Tap to close';
    }

    this.pad = new Gamepads(this);
    // A pad's button is not always a gesture the browser will start sound
    // for, so the first real click or key after BEGIN makes sure of it.
    const wakeAudio = () => {
      if (this.started && !this.hud.pauseOpen) this.audio.resume();
    };
    window.addEventListener('pointerdown', wakeAudio);
    window.addEventListener('keydown', (e) => { if (e.isTrusted) wakeAudio(); });

    this.quality.onChange((tier, reason) => this.onQualityChange(tier, reason));

    // BEGIN waits for the station's surfaces, so nobody walks into a room
    // made of placeholder grey.
    const startBtn = this.hud.el.startBtn;
    const label = this.state.hasProgress ? `CONTINUE — LOOP ${this.state.persistent.loop}` : 'BEGIN';
    onTextureProgress((done, total) => {
      const ready = this.hud.setLoading(done, total);
      startBtn.disabled = !ready;
      startBtn.textContent = ready ? label : `LOADING ${Math.floor((done / Math.max(1, total)) * 100)}%`;
    });
    // The first BEGIN goes by way of the brightness check: it is a gesture
    // too, so audio and the mouse still come up when it is dismissed.
    startBtn.addEventListener('click', () => {
      if (!this.settings.calibrated) {
        this.hud.el.overlay.classList.add('hidden');
        document.getElementById('calibrate').classList.remove('hidden');
        document.getElementById('calibdone').focus?.();
        return;
      }
      this.start();
    });
    document.getElementById('calibdone').addEventListener('click', () => {
      this.settings.set('calibrated', true);
      document.getElementById('calibrate').classList.add('hidden');
      this.start();
    });

    this.canvas.addEventListener('click', () => {
      if (!this.started || this.hud.modalOpen || this.ended || this.transitioning) return;
      this.lock();
    });

    // Holding a key, the mouse button or a finger down skips a cutscene.
    window.addEventListener('keyup', (e) => this.cutscene?.key(e.code, false));
    document.addEventListener('pointerdown', (e) => {
      if (!this.cutscene || this.hud.modalOpen) return;
      if (e.target.closest?.('button, .screen, #ending')) return;
      this.cutscene.key('pointer', true);
    });
    const release = () => this.cutscene?.key('pointer', false);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.player.lookEnabled = locked;
      if (locked) this.player.lookSettle = 1;
      // Losing the pointer for any reason we did not ask for -- Esc, alt-tab,
      // a notification -- pauses. Playing on with no way to look round while
      // he walks up behind you was the old behaviour.
      if (!locked) this.pauseIfUnattended();
    });
    // Some browsers and embeds refuse pointer lock outright. After a second
    // refusal, fall back to dragging to look rather than pausing forever.
    document.addEventListener('pointerlockerror', () => {
      this.lockErrors = (this.lockErrors ?? 0) + 1;
      if (this.lockErrors >= 2) {
        this.noLock = true;
        this.toast('Mouse lock unavailable: hold the left button and drag to look.');
        return;
      }
      this.pauseIfUnattended();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseIfUnattended();
    });
    // The wheel leans in to whatever is being read, and back out.
    window.addEventListener('wheel', (e) => {
      if (!this.started || this.hud.modalOpen || !this.player.inspecting) return;
      this.player.zoomInspect(e.deltaY < 0 ? 1.25 : 0.8);
    }, { passive: true });
    window.addEventListener('blur', () => {
      if (this.touch) this.pauseIfUnattended();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.started) return;
      // Holding a key repeats it. For a toggle or a one-shot that meant a
      // flashlight strobing on and off, a document opening and closing, and
      // G emptying every coin in your pocket across the room.
      if (e.repeat && e.code !== 'Space') {
        if (e.code === 'Tab') e.preventDefault();
        return;
      }

      if (this.hud.pauseOpen) {
        if (e.code === 'Escape') this.backFromScreen();
        return;
      }

      if (this.hud.dialsOpen) {
        if (this.hud.dialKey(e.code, e.key)) e.preventDefault();
        return;
      }

      // In a cutscene the keys only skip it, or pause.
      if (this.cutscene) {
        if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
        if (e.code === 'Escape' || e.code === 'KeyP') {
          if (!this.hud.endingOpen && !this.ended) this.pause();
          return;
        }
        this.cutscene.key(e.code, true);
        return;
      }

      if (e.code === 'Escape') {
        if (this.hud.readerOpen) this.hud.closeDocument();
        else if (this.hud.notebookOpen) this.closeNotebook();
        else if (!this.hud.endingOpen) this.pause();
        return;
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.hud.readerOpen || this.hud.endingOpen || this.transitioning || this.ended) return;
        if (this.hud.notebookOpen) {
          this.closeNotebook();
        } else {
          this.hud.toggleNotebook(this.state.persistent.notes, objectives(this));
          document.exitPointerLock?.();
        }
        return;
      }

      if (this.hud.readerOpen) {
        if (this.hud.hasChoices) {
          const n = /^Digit([1-9])$/.exec(e.code);
          if (n) this.hud.pick(Number(n[1]) - 1);
        } else if (e.code === 'KeyE') {
          this.hud.closeDocument();
        }
        return;
      }
      if (this.hud.notebookOpen || this.hud.endingOpen || this.transitioning || this.ended) return;

      if (e.code === 'KeyP') {
        this.pause();
        return;
      }
      if (e.code === 'KeyC' && this.settings.toggleCrouch && !this.touch) {
        this.player.crouchLatched = !this.player.crouchLatched;
        return;
      }
      if (e.code === 'KeyE') {
        this.tryInteract();
        return;
      }
      if (e.code === 'KeyF') {
        if (!this.state.run.hasFlashlight) {
          this.toast('You do not have a flashlight.');
          return;
        }
        this.player.toggleFlashlight();
        return;
      }
      if (e.code === 'KeyG') {
        this.throwCoin();
        return;
      }
      if (e.code === 'KeyB') {
        this.swapCell();
        return;
      }
      if (e.code === 'Digit1' && this.challenge?.keys.Digit1) {
        const c = this.challenge;
        this.challenge = null;
        c.keys.Digit1();
        return;
      }
      if (e.code === 'Digit2' && this.challenge?.keys.Digit2) {
        const c = this.challenge;
        this.challenge = null;
        c.keys.Digit2();
        return;
      }
      if (this.player.inspecting) {
        if (e.code === 'KeyZ') {
          this.player.cycleInspectZoom();
          return;
        }
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          this.player.zoomInspect(1.25);
          return;
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          this.player.zoomInspect(0.8);
          return;
        }
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          this.stopInspecting();
          return;
        }
      }
      if (this.player.watching) {
        const w = this.player.watching;
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
          w.focus = w.focus <= -1 ? 3 : w.focus - 1;
          return;
        }
        if (e.code === 'KeyD' || e.code === 'ArrowRight') {
          w.focus = w.focus >= 3 ? -1 : w.focus + 1;
          return;
        }
        const n = /^Digit([1-4])$/.exec(e.code);
        if (n) {
          w.focus = w.focus === Number(n[1]) - 1 ? -1 : Number(n[1]) - 1;
          return;
        }
        if (['KeyW', 'KeyS', 'KeyQ', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
          this.stopWatching();
          return;
        }
      }
      if (e.code === 'KeyR') {
        if (this.challenge?.keys.KeyR) {
          const c = this.challenge;
          this.challenge = null;
          c.keys.KeyR();
          return;
        }
        this.showTicket(true);
      }
    });
  }

  // ---- menus -------------------------------------------------------------

  initMenus() {
    const hud = this.hud;
    for (const btn of document.querySelectorAll('[data-open]')) {
      btn.addEventListener('click', () => {
        this.menuReturn = hud.pauseOpen ? 'pause' : null;
        hud.showScreen(btn.dataset.open);
      });
    }
    for (const btn of document.querySelectorAll('[data-back]')) {
      btn.addEventListener('click', () => this.backFromScreen());
    }
    document.getElementById('resumebtn').addEventListener('click', () => this.resume());

    // Two-step confirmations, because both of these throw something away.
    const confirmable = (btn, ask, act) => {
      const original = btn.textContent;
      let armed = false;
      let timer = null;
      btn.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          btn.textContent = ask;
          btn.classList.add('danger');
          timer = setTimeout(() => {
            armed = false;
            btn.textContent = original;
            btn.classList.remove('danger');
          }, 4000);
          return;
        }
        clearTimeout(timer);
        act();
      });
    };
    confirmable(document.getElementById('quitbtn'), 'QUIT? TONIGHT IS LOST', () => {
      // The save already holds everything learned; tonight's pockets are lost,
      // exactly as if the night had reset.
      window.location.reload();
    });
    const newBtn = hud.el.newBtn;
    if (this.state.hasProgress) newBtn.classList.remove('hidden');
    // For someone coming back: how far they have got, at a glance.
    if (this.state.hasProgress) {
      const p = this.state.persistent;
      const line = document.getElementById('progressline');
      line.textContent = [
        `LOOP ${p.loop}`,
        `ENDINGS ${p.endingsSeen.length} OF ${Object.keys(ENDINGS).length}`,
        `HEARD ${p.heardStories.length} OF ${PASSENGERS.length}`,
      ].join('   ·   ');
      line.classList.remove('hidden');
    }
    confirmable(newBtn, 'ERASE THE NOTEBOOK?', () => {
      this.state.wipe();
      window.location.reload();
    });

    // Settings.
    const s = this.settings;
    const sens = document.getElementById('set-sens');
    const fov = document.getElementById('set-fov');
    const vol = document.getElementById('set-vol');
    const invert = document.getElementById('set-invert');
    const calm = document.getElementById('set-calm');
    const out = (id, v) => { document.getElementById(id).textContent = v; };
    sens.value = s.sensitivity;
    fov.value = s.fov;
    vol.value = s.volume;
    invert.checked = s.invertY;
    calm.checked = s.calm;
    out('out-sens', `${Number(s.sensitivity).toFixed(2)}×`);
    out('out-fov', `${s.fov}°`);
    out('out-vol', `${Math.round(s.volume * 100)}%`);
    sens.addEventListener('input', () => {
      s.set('sensitivity', Number(sens.value));
      out('out-sens', `${Number(sens.value).toFixed(2)}×`);
    });
    fov.addEventListener('input', () => {
      s.set('fov', Number(fov.value));
      out('out-fov', `${fov.value}°`);
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    });
    vol.addEventListener('input', () => {
      s.set('volume', Number(vol.value));
      out('out-vol', `${Math.round(s.volume * 100)}%`);
      this.audio.setVolume(s.volume);
    });
    invert.addEventListener('change', () => s.set('invertY', invert.checked));
    calm.addEventListener('change', () => s.set('calm', calm.checked));

    // Brightness: on the settings screen and on the first-run check, kept in
    // step with each other.
    const brights = [...document.querySelectorAll('.set-bright')];
    const showBright = () => {
      for (const b of brights) b.value = s.brightness;
      for (const o of document.querySelectorAll('.out-bright')) o.textContent = `${Math.round(s.brightness * 100)}%`;
      this.ps1.setGamma(brightnessGamma(s.brightness));
      this.paintCalibration();
    };
    for (const b of brights) {
      b.addEventListener('input', () => {
        s.set('brightness', Number(b.value));
        showBright();
      });
    }
    showBright();

    // Difficulty: what it changes is said under it, so nobody has to guess.
    const diffBtn = document.getElementById('diffbtn');
    const DIFF_NOTES = {
      story: 'For the mystery more than the chase. He is slower, sees less, hears less, and gives you longer before he starts; you can hold your breath longer.',
      standard: 'As the night was meant to be.',
      nightmare: 'He is quicker, sees further, hears more, and barely waits. Your breath runs out sooner.',
    };
    const showDiff = () => {
      diffBtn.textContent = DIFFICULTY[s.difficulty].label;
      document.getElementById('diffnote').textContent = DIFF_NOTES[s.difficulty];
    };
    diffBtn.addEventListener('click', () => {
      const order = ['story', 'standard', 'nightmare'];
      s.set('difficulty', order[(order.indexOf(s.difficulty) + 1) % order.length]);
      showDiff();
    });
    showDiff();

    const hintsBox = document.getElementById('set-hints');
    hintsBox.checked = s.hints !== false;
    hintsBox.addEventListener('change', () => s.set('hints', hintsBox.checked));

    const crouch = document.getElementById('set-crouch');
    const showCrouch = () => {
      crouch.checked = s.toggleCrouch;
      document.getElementById('crouchkey').textContent = s.toggleCrouch ? 'Crouch (toggle)' : 'Crouch (hold)';
    };
    crouch.addEventListener('change', () => {
      s.set('toggleCrouch', crouch.checked);
      this.player.crouchLatched = false;
      showCrouch();
    });
    showCrouch();

    const textBtn = document.getElementById('textbtn');
    const TEXT_LABELS = ['SMALL', 'MEDIUM', 'LARGE', 'HUGE'];
    const showText = () => {
      document.documentElement.style.setProperty('--text-scale', String(s.textScale));
      textBtn.textContent = TEXT_LABELS[TEXT_SCALES.indexOf(s.textScale)] ?? 'MEDIUM';
    };
    textBtn.addEventListener('click', () => {
      const i = TEXT_SCALES.indexOf(s.textScale);
      s.set('textScale', TEXT_SCALES[(i + 1) % TEXT_SCALES.length]);
      showText();
    });
    showText();

    // Fullscreen, where the page is allowed it (an itch.io embed is; an
    // iPhone is not).
    const root = document.documentElement;
    if (document.fullscreenEnabled && root.requestFullscreen) document.body.classList.add('can-fs');
    const fsBtns = [...document.querySelectorAll('.fsbtn')];
    const showFs = () => {
      const on = !!document.fullscreenElement;
      for (const b of fsBtns) b.textContent = b.classList.contains('chip') ? (on ? 'EXIT' : 'ENTER') : (on ? 'EXIT FULLSCREEN' : 'FULLSCREEN');
    };
    for (const b of fsBtns) {
      b.addEventListener('click', () => {
        const p = document.fullscreenElement ? document.exitFullscreen?.() : root.requestFullscreen?.({ navigationUI: 'hide' });
        p?.catch?.(() => this.toast('Fullscreen is not allowed here.'));
      });
    }
    document.addEventListener('fullscreenchange', () => {
      showFs();
      // Going fullscreen from a menu changes the size under the game.
      this.resize();
    });
    showFs();

    // Graphics: AUTO -> HIGH -> MEDIUM -> LOW. AUTO picks by device and lets
    // the governor step down; a fixed choice is held exactly.
    const gfx = document.getElementById('gfxbtn');
    const showGfx = () => { gfx.textContent = this.quality.settingLabel(); };
    showGfx();
    this.quality.onChange(showGfx);
    gfx.addEventListener('click', () => this.quality.cycleSetting());
  }

  // The three marks on the brightness check, painted with the same curve
  // the game's last pass applies to the picture (render.js, uGamma, and the
  // lift under it).
  paintCalibration() {
    const g = brightnessGamma(this.settings.brightness);
    for (const mark of document.querySelectorAll('.calib .mark')) {
      const v = Number(mark.dataset.v);
      const out = Math.pow(v, g) * 0.985 + 0.012;
      const c = Math.round(Math.min(1, out) * 255);
      mark.querySelector('i').style.background = `rgb(${c}, ${c}, ${c})`;
    }
  }

  backFromScreen() {
    const back = this.menuReturn;
    this.menuReturn = null;
    if (this.hud.pauseOpen) {
      if (back === 'pause' || this.hud.el.pause.classList.contains('hidden')) this.hud.showScreen('pause');
      return;
    }
    this.hud.showScreen(null);
  }

  // Requests mouse look. Only works from a user gesture; when it does not
  // take, the pause screen gives the player something to click.
  lock() {
    // A controller needs no mouse, and asking for it from a button press
    // only fails.
    if (this.touch || this.noLock || this.pad?.active) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      p?.catch?.(() => this.pauseIfUnattended());
    } catch {
      this.pauseIfUnattended();
    }
  }

  // Back to the game after a document or the notebook closes.
  returnToPlay() {
    if (!this.started || this.hud.modalOpen || this.ended || this.transitioning) return;
    this.lock();
    // If the browser refused the lock -- Esc is not a gesture it will grant
    // one for -- say so rather than leaving the player unable to look round.
    clearTimeout(this.lockCheck);
    this.lockCheck = setTimeout(() => {
      if (!this.touch && document.pointerLockElement !== this.canvas) this.pauseIfUnattended();
    }, 400);
  }

  pauseIfUnattended() {
    if (!this.started || this.hud.modalOpen || this.ended || this.transitioning) return;
    if (!this.touch && (this.noLock || this.pad?.active || document.pointerLockElement === this.canvas)) return;
    this.pause();
  }

  // `kind` is 'wake' after the night resets on its own: the browser will not
  // hand back the mouse without a click, so the click is the waking up.
  pause(kind = 'pause') {
    if (!this.started || this.ended || this.transitioning || this.hud.modalOpen) return;
    const wake = kind === 'wake';
    // Waking up is a scene of its own, and it plays once the click is in.
    if (wake) this.wakePending = true;
    this.hud.el.pause.querySelector('h2').textContent = wake ? `LOOP ${this.state.persistent.loop}` : 'PAUSED';
    document.getElementById('pausesub').textContent = wake
      ? 'You wake up on the bench. The clock says 11:47 PM.'
      : 'The station waits for you. It is good at waiting.';
    // Where you had got to, for anyone who paused to remember.
    const next = document.getElementById('pausenext');
    next.textContent = wake || this.settings.hints === false ? '' : nextStep(this);
    next.classList.toggle('hidden', !next.textContent);
    document.getElementById('resumebtn').textContent = wake ? 'WAKE UP' : 'RESUME';
    this.hud.openPause();
    this.audio.suspend();
    // Anything held stays held otherwise: let go of W behind a menu and you
    // walk on forever when it closes.
    for (const code of Object.keys(this.player.keys)) this.player.keys[code] = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  resume() {
    if (!this.hud.pauseOpen) return;
    this.hud.closePause();
    this.audio.resume();
    this.lastFrame = performance.now();
    this.lock();
    if (this.wakePending) {
      this.wakePending = false;
      this.playWake();
    }
  }

  closeNotebook() {
    this.hud.closeNotebook();
    this.returnToPlay();
  }

  start() {
    if (this.started || !texturesReady()) return;
    this.started = true;
    this.hud.hideOverlay();
    this.hud.showHUD(true);
    this.audio.init();
    this.audio.resume();
    this.lock();
    this.clock.start();
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.player.pitch = 0;
    this.lastFrame = performance.now();

    // Attach the moving sound sources now that the context exists.
    this.attendant.attachAudio(this.audio);
    const jp = this.refs.jukeboxPos;
    this.jukeEmitter = this.audio.makeEmitter(jp.x, jp.z, 24);
    this.busEmitter = this.audio.makeEmitter(-22, -29, 34);
    this.audio.startDiesel(this.busEmitter);
    // Harold is right: there is an engine running at the end of the tunnel.
    this.bay0Emitter = this.audio.makeEmitter(35, 2, 26);
    this.bay0Emitter.volume = 0.7;
    this.audio.startDiesel(this.bay0Emitter);
    this.beltEmitter = this.audio.makeEmitter(11, 18.5, 18);
    this.beltEmitter.volume = 0.25;
    this.audio.startConveyor(this.beltEmitter);
    this.boardEmitter = this.audio.makeEmitter(0, -9.1, 26);
    this.ambience.start();

    this.playWake();
  }

  // ---- cutscenes ----------------------------------------------------------

  // Plays `script` (see cutscene.js); `onDone` runs once it has finished or
  // been skipped, with everything it moved already put back.
  playCutscene(script, onDone) {
    this.cutscene?.finish();
    const cs = new Cutscene(this, script, (c) => {
      if (this.cutscene === c) this.cutscene = null;
      this.lastFrame = performance.now();
      onDone?.(c);
    });
    this.cutscene = cs;
    for (const code of Object.keys(this.player.keys)) this.player.keys[code] = false;
    cs.start();
    // The test harness, and anyone who has seen enough of them.
    if (this.skipCutscenes) cs.skip();
    return cs;
  }

  // Waking on the bench at 11:47, every night.
  playWake() {
    const first = this.state.persistent.loop <= 1 && !this.state.persistent.lastNight;
    this.playCutscene(wakeScene(this), (cs) => {
      // Whatever the head was turned to at the end, the body turns to it.
      this.player.yaw += cs.lookYaw;
      this.player.pitch = Math.max(-1.2, Math.min(1.2, this.player.pitch + cs.lookPitch));
      this.note('Goal', 'Board the 3:33 AM bus at Bay 9 with a valid ticket: stub, stamp, punched transfer.');
      // The first night, the keys, once. A tablet has them on its buttons.
      if (first && !this.touch) {
        this.hud.keyHint((this.pad.active ? [
          '<kbd>L</kbd> move <kbd>R</kbd> look',
          '<kbd>A</kbd> use',
          '<kbd>B</kbd> crouch',
          '<kbd>RT</kbd> run <em>(against the rules)</em>',
          '<kbd>VIEW</kbd> notebook, and what to do next',
        ] : [
          '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move',
          '<kbd>E</kbd> use',
          '<kbd>C</kbd> crouch',
          '<kbd>Shift</kbd> run <em>(against the rules)</em>',
          '<kbd>Tab</kbd> notebook, and what to do next',
        ]).map((l) => `<span>${l}</span>`).join(''));
      }
    });
  }

  // A frame of a cutscene. The world is frozen; the scene moves what it
  // moves, and the lights, shadows, fog and sound follow the camera.
  updateCutscene(dt, t) {
    const cs = this.cutscene;
    cs.update(dt);
    if (this.cutscene !== cs) return;
    const cam = this.camera.position;
    this.camera.getWorldDirection(_dir);
    this.audio.setListener(cam.x, cam.z, Math.atan2(-_dir.x, -_dir.z));
    this.audio.setSpace(roomAt(cam.x, cam.z) ?? 'outside');
    this.audio.updateEmitters((x, z) => segmentBlocked(this.level.colliders, x, z, cam.x, cam.z));
    this.updateLights(dt, t, cam);
    this.ps1.updateShadowBudget(cam, dt, this.collectShadowCasters());
    this.atmosphere.update(dt, t);
  }

  // ---- helpers the world calls into --------------------------------------

  toast(text) {
    this.hud.toast(text);
  }

  subtitle(text, duration = 3.5, priority = 1) {
    this.hud.subtitle(text, duration, false, priority);
  }

  note(category, text) {
    if (this.state.addNote(category, text)) {
      this.hud.toast(`Written in your notebook  ·  ${this.key('TAB')}`);
    }
  }

  // The name of a control, as this player presses it.
  key(code) {
    if (this.pad?.active) return { E: 'A', SPACE: 'LT', Q: 'B', G: 'LB', B: 'RB', F: 'X', R: 'Y', TAB: 'VIEW' }[code] ?? code;
    if (!this.touch) return code;
    return { E: 'USE', SPACE: 'HOLD BREATH', Q: 'LEAVE', G: 'COIN', B: 'CELL', F: 'LIGHT', TAB: 'NOTES' }[code] ?? code;
  }

  // A letter lock, up close. `onTry(word)` returns true when it opens. The
  // dials stay where they were left until the night resets.
  openDials({ title, text, onTry }) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    const start = this.lastDials ?? Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    this.hud.showDials({
      title,
      text,
      start,
      onTurn: () => this.audio.blip({ freq: 2300 + Math.random() * 400, type: 'square', dur: 0.012, vol: 0.05 }),
      onTry: (word) => {
        this.lastDials = word;
        return onTry(word);
      },
      onClose: () => this.returnToPlay(),
    });
  }

  showDocument(title, lines, choices = null, opts = {}) {
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.hud.showDocument(title, lines, choices, () => this.returnToPlay(), opts);
  }

  // Throwing spends a coin out of the same pile the ticket machine wants four
  // of, which is the whole point: the fare is the ammunition. The coin is not
  // gone, though -- it is lying wherever you sent him, and getting it back
  // means going there.
  throwCoin() {
    // Put the page down first.
    this.player.stopInspecting();
    if (this.player.hiding || this.player.watching) {
      this.toast('Not from in here.');
      return;
    }
    if (!this.state.run.coins) {
      this.toast('No coins to throw.');
      return;
    }
    this.state.run.coins--;
    const fwd = this.player.forward;
    // Built from the player rather than from `camera.position`, which carries
    // a frame of lag plus the bob and fear shake. Offset past the collision
    // radius so a coin never starts inside a wall the player is pressed to.
    const from = new THREE.Vector3(
      this.player.position.x + fwd.x * 0.45,
      this.player.eyeHeight - 0.12,
      this.player.position.z + fwd.z * 0.45
    );
    // Pitch is not folded into the throw direction: a player looking at their
    // feet would drop it on them, and this tool must never make the noise here.
    this.throwables.throwCoin(from, fwd);
    this.note('Coins', 'A thrown coin pulls him to where it lands. It costs a quarter of a fare, and it is still there afterwards.');
  }

  swapCell() {
    if (!this.state.run.hasFlashlight) return;
    if (!this.state.run.cells) {
      this.toast(this.player.battery > 0.5 ? 'No spare cells.' : 'No spare cells. Use it sparingly.');
      return;
    }
    if (this.player.battery > 0.9) {
      this.toast('These are still good.');
      return;
    }
    this.state.run.cells--;
    this.player.battery = 1;
    this.audio.lockClick(true);
    this.toast(`Fresh cell in (${this.state.run.cells} spare)`);
  }

  makeNoise(x, z, loudness, label) {
    this.attendant.hear(x, z, loudness, label);
    // Breaking a rule in front of a passenger is reported even if he is far.
    _to.set(x, 0, z);
    const echo = this.echoes.nearestWithin(_to, 6);
    if (echo && loudness > 0.6) {
      this.attendant.hear(x, z, Math.min(1, loudness + 0.2), label);
    }
  }

  // The ticket is "out" for a few game minutes after you handle it, which is
  // what the 1:00-2:00 rule is really about.
  showTicket(deliberate = false) {
    if (!this.state.run.ticketStub) {
      if (deliberate) this.toast('You have no ticket to show.');
      return;
    }
    this.state.run.ticketVisibleUntil = this.clock.time + (deliberate ? 4 : 3);
    if (deliberate) {
      this.toast(`Ticket: ${this.state.ticketParts.join(' + ') || 'blank'}`);
    }
  }

  attendantHasRing() {
    // He carries it on his midnight rounds; otherwise it hangs in Security.
    return this.clock.isBetween('00:30', '01:30');
  }

  learnLockerCode(initials) {
    if (this.state.learnCode('locker', initials)) {
      this.note('Locker', `The cancelled destinations spell ${initials}. That is the locker word.`);
      this.toast(`You write down: ${initials}`);
    }
  }

  // ---- rule-driven moments -----------------------------------------------

  callPlayerName() {
    const line = PA_LINES.nameCall[Math.floor(Math.random() * PA_LINES.nameCall.length)];
    this.pa(line);
    this.challenge = {
      prompt: `<kbd>R</kbd> Answer the PA<span class="sep"></span>or say nothing`,
      until: 9,
      keys: {
        KeyR: () => {
          this.answeredPA = true;
          this.subtitle('You say "yes". Your own voice comes back out of the speakers.', 5);
        },
      },
    };
  }

  askTheTime(echo) {
    this.timeChallenge = echo;
    this.subtitle(`${echo.def.name}: "Excuse me. Do you have the time?"`, 7);
    this.challenge = {
      prompt: '<kbd>1</kbd> "It is 11:47."<span class="sep"></span><kbd>2</kbd> Tell them the real time',
      until: 8,
      keys: {
        Digit1: () => {
          this.subtitle(`${echo.def.name}: "11:47. Of course it is. Thank you."`, 4);
          this.timeChallenge = null;
          this.note('Rules', 'Telling a passenger it is 11:47 satisfies them. The real time does not.');
        },
        Digit2: () => {
          this.toldWrongTime = true;
          this.subtitle(`${echo.def.name} stops muttering. They are looking past you, at someone.`, 5);
          this.timeChallenge = null;
        },
      },
      onExpire: () => {
        this.timeChallenge = null;
        this.subtitle(`${echo.def.name}: "...never mind."`, 3);
      },
    };
  }

  onFalseRuleBroken(rule) {
    // Nothing happens, and the player gets to notice that nothing happened --
    // unless they already know it is a lie, or could not have obeyed it.
    if (this.state.knowsFake(rule.id)) return;
    if (rule.id === 'flashlight_lit' && !this.state.run.hasFlashlight) return;
    if (Math.random() < 0.5) {
      this.subtitle('You broke a posted rule. Nothing came.', 3);
    }
  }

  onAttendantAlerted(label, loudness) {
    if (loudness > 0.5) this.subtitle(`The keys change direction. He heard ${label}.`, 3.5);
  }

  onHuntStart() {
    this.audio.cutHum(1.0);
    this.audio.stinger();
    this.fear.jolt(1);
    this.fear.kick('red', 0.7);
    this.fear.claim(3);
    this.subtitle('He has seen you.', 2.5);
  }

  // Held your breath too long.
  onGasp() {
    this.audio.gasp();
    this.subtitle('You cannot hold it any longer. The breath tears out of you.', 3);
    this.fear.kick('shake', 0.4);
    this.makeNoise(this.player.position.x, this.player.position.z, 0.32, 'you gasping for air');
  }

  // ---- machines -----------------------------------------------------------

  // Sit down at the console. The four screens are live; A and D lean in to
  // one at a time. Nothing about the rest of the station stops while you do.
  watchMonitors() {
    if (this.player.watching) {
      this.stopWatching();
      return;
    }
    this.player.startWatching();
    this.cameraViews = this.describeCameras();
    this.refs.monitors?.redraw();
    this.note('Security', 'The monitors in Security show where the Attendant is.');
  }

  stopWatching() {
    if (!this.player.watching) return;
    this.player.watching = null;
  }

  // Lean in to read something, the same way the console is watched: the eye
  // goes to it (see inspect.js), and nothing else in the station waits while
  // you read. `target` is { label, view, caption?, onStart?, onEnd?, update? }.
  inspect(target) {
    const p = this.player;
    if (p.hiding || p.watching) return;
    p.startInspecting(target);
    target.onStart?.();
    const caption = typeof target.caption === 'function' ? target.caption() : target.caption;
    if (caption) this.subtitle(caption, Math.max(4, caption.length / 15));
  }

  stopInspecting() {
    this.player.stopInspecting();
  }

  // The shape on the CCTV, the first time each loop you are at the console
  // while it is on a screen.
  onSawCamera4() {
    if (this.sawCamera4ThisLoop) return;
    this.sawCamera4ThisLoop = true;
    const anomalyCam = 4 - Math.min(3, this.state.persistent.sawCamera4);
    this.state.persistent.sawCamera4++;
    this.state.save();
    this.fear.jolt(0.6);
    this.subtitle(`Camera ${anomalyCam}. There is a shape in that room that the room does not contain.`, 5);
    this.note('Camera 4', `Loop ${this.state.persistent.loop}: the thing was on camera ${anomalyCam}. Each loop it is one camera closer.`);
    if (anomalyCam <= 1) {
      this.later(5.5, () => this.subtitle('Camera 1 is the waiting hall. The room with the bench you wake up on.', 5));
      this.note('Camera 4', 'It has reached camera 1. That is the hall where you wake up.');
    }
  }

  // Where the eye goes while watching, and how wide it sees.
  watchPose() {
    return this.cctv.watchPose(this.player.watching?.focus ?? -1, this.camera.aspect);
  }

  // Leaning in narrows the view; standing up gives it back.
  updateFov(dt) {
    // Leaning in to read sets its own, as part of the same travel.
    if (this.player.inspecting) return;
    const want = this.player.watching ? this.watchPose().fov : this.settings.fov;
    if (Math.abs(this.camera.fov - want) < 0.02) return;
    this.camera.fov += (want - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();
  }

  describeCameras() {
    const attendantRoom = roomAt(this.attendant.position.x, this.attendant.position.z);
    const anomalyCam = 4 - Math.min(3, this.state.persistent.sawCamera4);
    const defs = [
      { label: 'WAITING HALL', rooms: ['hall'] },
      { label: 'BAGGAGE CLAIM', rooms: ['baggage'] },
      { label: 'BAY 9', rooms: ['bays'] },
      { label: 'SERVICE TUNNEL', rooms: ['tunnel', 'bay0'] },
    ];
    return defs.map((d, i) => ({
      label: d.label,
      attendant: d.rooms.includes(attendantRoom),
      // The Presence layer parks him at a lens now and then: a shape filling
      // the whole cell, facing out, in a room you are not in.
      staring: this.presence?.cctvStare?.cam === i ? this.presence.cctvStare.variant : 0,
      anomaly: this.camera4Active && i + 1 === anomalyCam ? 'UNKNOWN' : null,
    }));
  }

  usePAMic() {
    const targets = [
      { label: 'Announce a cleanup in Baggage Claim', node: 'bag_c' },
      { label: 'Announce lost property in the Ticket Office', node: 'ticket_c' },
      { label: 'Announce a spill at the Diner Counter', node: 'diner_c' },
      { label: 'Announce a disturbance in the Restrooms', node: 'rest_c' },
      { label: 'Announce a departure at Bay 9', node: 'bay_w' },
    ];
    this.showDocument(
      'PA Microphone',
      [
        'The microphone is live. The whole building will hear you,',
        'including the one person in it who still does his rounds by the book.',
        '',
        'He will walk to wherever you send him, and stay a while.',
      ],
      targets.map((t) => ({
        label: t.label,
        onPick: () => {
          this.pa(t.label.replace('Announce ', 'Attention. There is ') + '. Attendant to respond.');
          if (this.attendant.lureTo(t.node)) {
            this.toast('He is on his way there.');
            this.note('Security', 'The PA microphone in Security sends the Attendant anywhere you name.');
          } else if (this.attendant.state === 'wait') {
            this.toast('Nothing moves. He is not leaving Bay 9 now.');
          }
        },
      })),
      { style: 'panel' }
    );
  }

  useJukebox(redraw) {
    if (this.state.run.coins < 1) {
      this.toast('It wants a coin.');
      return;
    }
    const knowsSong = this.state.knowsCode('jukebox');
    const options = [
      { id: 'A1', label: 'A1 — BLUE HIGHWAY' },
      { id: 'A2', label: 'A2 — LAST CALL FOR EVERYTHING' },
      { id: 'B3', label: 'B3 — HOLLOW MOON' + (knowsSong ? '   (Marguerite\'s song)' : '') },
    ];
    this.showDocument(
      'Jukebox',
      ['One coin. Three buttons. The glass is warm.'],
      options.map((o, i) => ({
        label: o.label,
        own: o.id === 'B3' && knowsSong,
        onPick: () => {
          this.state.run.coins--;
          this.state.run.jukeboxPlayed = true;
          redraw?.();
          const length = this.audio.playJukebox(this.jukeEmitter, i);
          // Otis was right: for the length of a record the hall is deaf, him
          // included. (Walter is deaf to the jukebox itself, too: starting it
          // does not bring him.)
          this.jukeboxUntil = this.simTime + length;
          this.note('Jukebox', 'While a record plays, he hears nothing. Neither do you: listen for the song to end.');
          if (o.id === 'B3') {
            this.subtitle('The song is "Hollow Moon". The PA cuts in over it.', 5);
            this.later(1.8, () => {
              this.pa(PA_LINES.hiddenAnnouncement.join(' '));
              this.note('PA', 'Playing "Hollow Moon" makes the PA read a hidden announcement about the keyring.');
              this.note('Keyring', 'Walter is deaf to the jukebox. Play it and take the ring off the hook.');
            });
          } else {
            this.subtitle('A warped tune fills the hall. Nothing answers it.', 4);
          }
        },
      })),
      { style: 'panel' }
    );
  }

  // Leaning in to the restroom mirror. Before two it is only glass; after,
  // the sign on the far wall shows in it with two fewer rules than the wall.
  useMirror() {
    const mirror = this.refs.mirrorTarget;
    if (!this.mirrorRevealing) {
      this.inspect(mirror);
      this.subtitle('Tarnished glass. Your reflection, in low light, from slightly the wrong angle. Behind it the rules sign on the far wall, reversed, and perfectly ordinary.', 7);
      this.later(7.2, () => {
        if (this.player.inspecting?.target === mirror) this.subtitle('Sister Ruiz said: after two in the morning.', 4);
      });
      this.note('Rules', 'The restroom mirror only shows the truth after 2:00 AM.');
      return;
    }
    this.refs.mirror?.redraw();
    const revealed = [];
    for (const id of ['board_stare', 'flashlight_lit']) {
      if (this.state.markFakeRule(id)) revealed.push(id);
    }
    this.audio.cutHum(1.6);
    this.inspect(mirror);
    this.subtitle('In the glass, the sign on the far wall has two fewer rules than the wall does. The rest are in the same handwriting in both.', 6);
    this.later(6.2, () => this.subtitle(revealed.length
      ? 'You cross them off. Watch the board as long as you like. Keep the light off.'
      : 'You already knew.', 5));
    this.note('Rules', 'FALSE RULES: the departure board rule, and the flashlight rule. The rest are real.');
    this.refreshSign();
  }

  chooseSlip(options) {
    this.showDocument(
      'Transfer Slips',
      [
        'A shoebox of punched and unpunched transfers, all dated November 3 1987.',
        'Whichever one you use is where the bus takes you.',
        '',
        this.state.run.hasPunch
          ? 'You have the conductor\'s punch, so you can validate one now.'
          : 'Without the conductor\'s punch, a slip is just paper.',
      ],
      options.map((o) => ({
        label: o.label,
        own: o.own,
        onPick: () => {
          this.state.run.chosenSlip = o.id;
          if (!this.state.run.hasPunch) {
            this.toast('You take the slip. It still needs punching.');
            this.note('Ticket', 'A transfer slip is worthless until the conductor\'s punch validates it.');
            return;
          }
          this.state.run.ticketPunched = true;
          this.showTicket();
          this.audio.stamp();
          this.makeNoise(-12.1, 0.7, 0.4, 'the punch');
          this.toast(o.own ? 'Your own slip, punched.' : 'Slip punched.');
        },
      })),
      { style: 'panel' }
    );
  }

  returnBelonging(passenger, echo) {
    this.carrying = null;
    echo.heard = true;
    this.state.hearStory(passenger.id);
    const reward = passenger.reward ?? {};
    if (reward.note) this.note(reward.note[0], reward.note[1]);
    if (reward.code) this.state.learnCode(reward.code[0], reward.code[1]);
    if (reward.flag) {
      this.state.persistent[reward.flag] = true;
      this.state.save();
    }
    this.audio.cutHum(1.2);
    const total = PASSENGERS.length;
    const heard = this.state.persistent.heardStories.length;
    this.showDocument(passenger.name, [
      `You hold out ${theItem(passenger.item)}. They take it without touching you.`,
      '',
      ...passenger.story,
      '',
      `HEARD: ${heard} of ${total}`,
      heard >= total
        ? 'All of them have been heard. There is a new slip in the box in Lost & Found, and it has your name on it.'
        : 'The others are still waiting.',
    ], null, { style: 'panel' });
    if (heard >= total) {
      this.note('Endings', 'All passengers heard. A slip with your own name is now in the Lost & Found box.');
    }
  }

  // ---- bus and endings ----------------------------------------------------

  ticketIsBoardable() {
    return this.state.ticketValid;
  }

  busPrompt() {
    if (!this.clock.isAfter('03:25')) {
      return 'The doors are shut. Departure 3:33 AM.';
    }
    if (!this.state.ticketValid) {
      const missing = [];
      if (!this.state.run.ticketStub) missing.push('stub');
      if (!this.state.run.ticketStamped) missing.push('stamp');
      if (!this.state.run.ticketPunched) missing.push('punched transfer');
      return `Board (you are missing: ${missing.join(', ')})`;
    }
    return this.state.run.hasWalkie ? 'Board the 3:33 — or call Walter on the walkie' : 'Board the 3:33 to the coast';
  }

  tryBoardBus() {
    if (!this.clock.isAfter('03:25')) {
      this.toast('The doors do not open until the board says so.');
      return;
    }
    this.showTicket();
    if (!this.state.ticketValid) {
      this.onCaught('"Not without a ticket," he says, almost kindly.');
      return;
    }
    const board = () => {
      this.state.run.boarded = true;
      this.triggerEnding(this.state.run.chosenSlip === 'self' ? 'home' : 'coast');
    };
    // With his walkie from the safe, there is someone else the ticket could
    // be for.
    if (this.state.run.hasWalkie) {
      this.showDocument('Bay 9', [
        'The doors fold open. The driver does not look round.',
        '',
        'The walkie from Walter\'s safe crackles in your pocket. Out on the platform,',
        'his radio answers it, and he turns his head toward you.',
        '',
        'He has been here since 1987. He has never once had a ticket of his own.',
      ], [
        { label: 'Board the bus', onPick: board },
        {
          label: 'Give Walter your ticket',
          onPick: () => {
            this.state.run.boarded = true;
            this.triggerEnding('nightshift');
          },
        },
      ], { style: 'panel' });
      return;
    }
    board();
  }

  triggerEnding(id) {
    if (this.ended) return;
    this.ended = true;
    this.clock.paused = true;
    this.state.recordEnding(id);
    this.state.persistent.lastNight = id;
    this.state.persistent.loop++;
    this.state.save();
    const card = () => {
      document.exitPointerLock?.();
      this.audio.cutHum(4);
      // The scene ends on black; the card comes up out of it.
      this.hud.fade(true, true);
      setTimeout(() => {
        const all = Object.values(ENDINGS);
        this.hud.showEnding(ENDINGS[id], this.state.persistent.endingsSeen, all, () => {
          this.ended = false;
          this.resetLoop();
          // A click on CONTINUE is a gesture: the mouse can come straight back.
          this.lock();
          this.playWake();
        });
      }, 400);
    };
    const scene = ENDING_SCENES[id];
    if (scene) this.playCutscene(scene(this), card);
    else card();
  }

  onCaught(reason) {
    if (this.transitioning || this.ended || this.cutscene) return;
    this.transitioning = true;
    this.state.run.caught = true;
    this.state.persistent.lastNight = 'caught';
    this.clock.paused = true;

    // The whole night has been building to this frame, so it gets everything:
    // his face held on the lens, the screen washed red, and the sound of the
    // station pulled out from under it.
    this.audio.stinger();
    this.audio.deafen(3.4);
    this.fear.claim(6);
    this.fear.jolt(1.4);
    this.fear.kick('red', 1);
    this.fear.kick('whiteFlash', 0.8);
    this.fear.fear = 1;
    this.presence.flashFace(0, 1.3);
    this.subtitle(reason, 4);
    document.exitPointerLock?.();

    // The fade starts late, so the player sits with it first.
    setTimeout(() => this.hud.fade(true), 1500);
    setTimeout(() => {
      this.state.persistent.loop++;
      this.state.save();
      this.resetLoop();
      this.pause('wake');
    }, 3000);
  }

  onDeparted() {
    // 3:33 came and went without you on the bus.
    if (this.transitioning || this.ended || this.cutscene) return;
    this.transitioning = true;
    this.state.persistent.lastNight = 'departed';
    this.clock.paused = true;
    this.subtitle('3:33. Somewhere outside, a diesel engine pulls away without you.', 5);
    this.audio.cutHum(4);
    this.hud.fade(true);
    document.exitPointerLock?.();
    setTimeout(() => {
      this.state.persistent.loop++;
      this.state.save();
      this.resetLoop();
      this.pause('wake');
    }, 3200);
  }

  resetLoop() {
    this.state.newLoop();
    this.clock.reset();
    this.timers = [];
    this.jukeboxUntil = -1;
    this.blackoutHold = 0;
    this.level.relockDoors();
    for (const light of this.level.lights) {
      light.broken = false;
      light.flicker = light.baseFlicker;
      light.blackout = 0;
    }
    for (const it of this.level.interactables) {
      it.enabled = true;
      it.onReset?.();
    }
    for (const spot of this.level.hideSpots) spot.occupied = false;
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.player.flashlightOn = false;
    this.player.battery = 1;
    this.attendant.reset();
    this.echoes.reset();
    this.throwables.clear();
    this.fear.reset();
    this.director?.reset();
    this.presence?.reset();
    this.cctv?.reset();
    this.phoneRinging = false;
    this.carrying = null;
    this.boardStare = 0;
    this.boardRevealed = false;
    this.boardingCalled = false;
    this.mirrorRevealing = false;
    this.camera4Active = false;
    this.sawCamera4ThisLoop = false;
    this.challenge = null;
    this.timeChallenge = null;
    this.lastDials = null;
    this.boardRows = this.baseBoardRows();
    this.refs.board?.redraw();
    this.refs.mirror?.redraw();
    this.refreshSign();
    this.hud.setLoop(this.state.persistent.loop);
    this.audio.setHumLevel(0.085);
    this.hud.fade(false);
    this.transitioning = false;
    this.lastFrame = performance.now();
    // What you wake up to is the wake scene's to say (playWake).
  }

  refreshSign() {
    this.ruleSignRows = this.rules.signText(this.state.persistent.loop, this.state);
    this.refs?.rulesSign?.redraw();
  }

  pa(text) {
    this.audio.pa(text);
    this.subtitle(`PA: "${text}"`, 7);
  }

  // ---- interaction --------------------------------------------------------

  bestInteractable() {
    if (this.player.watching || this.player.inspecting) return null;
    const origin = this.camera.position;
    this.camera.getWorldDirection(_dir);

    let best = null;
    let bestScore = -Infinity;

    for (const it of this.level.interactables) {
      if (!it.enabled) continue;
      if (it.enabledWhen && !it.enabledWhen()) continue;
      _to.subVectors(it.position, origin);
      const dist = _to.length();
      if (dist > it.radius) continue;
      _to.divideScalar(Math.max(1e-6, dist));
      // A page faces one way. From behind the partition it is taped to, it
      // is not there to read. (A little leeway, so a page lying on a counter
      // can still be read by someone crouched just below its edge.)
      if (it.facing && _to.dot(it.facing) > 0.2) continue;
      const aim = _to.dot(_dir);
      if (aim < 0.6) continue;
      const score = aim * 2 - dist * 0.05;
      if (score <= bestScore) continue;
      // Not through a wall: the ticket machine from the manager's office,
      // the slips from the hall, the note taped inside the next stall.
      if (sightBlockedTo(this.level.colliders, origin.x, origin.z, it.position.x, it.position.z)) continue;
      bestScore = score;
      best = it;
    }

    // Hiding spots compete with interactables for the prompt. They have to be
    // roughly in front of you as well: before, standing next to a bench meant
    // "Hide under bench" whatever you were looking at.
    let bestSpot = null;
    let bestSpotScore = -Infinity;
    if (!this.player.hiding) {
      const p = this.player.position;
      for (const spot of this.level.hideSpots) {
        if (spot.occupied) continue;
        const dx = spot.position.x - p.x;
        const dz = spot.position.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.7) continue;
        const facing = d < 0.6 ? 1 : (dx * _dir.x + dz * _dir.z) / (d * Math.max(1e-6, Math.hypot(_dir.x, _dir.z)));
        if (facing < 0.2) continue;
        const score = facing - d * 0.3;
        if (score > bestSpotScore) {
          bestSpotScore = score;
          bestSpot = spot;
        }
      }
    }

    if (bestSpot && (!best || bestScore < 1.4)) return { spot: bestSpot };
    return best ? { it: best } : null;
  }

  tryInteract() {
    if (this.player.hiding) {
      this.player.exitHide();
      return;
    }
    if (this.player.watching) {
      this.stopWatching();
      return;
    }
    if (this.player.inspecting) {
      this.stopInspecting();
      return;
    }
    const target = this.bestInteractable();
    if (!target) return;
    if (target.spot) {
      this.player.enterHide(target.spot);
      return;
    }
    target.it.use();
    target.it.redraw?.();
  }

  // ---- per-frame ----------------------------------------------------------

  // Things that move and throw shadows. Only objects that actually moved,
  // turned, changed pose or appeared/vanished since the last frame are
  // returned, so a frozen Attendant costs nothing and a vanishing figure takes
  // its shadow with it.
  collectShadowCasters() {
    const out = this.shadowCasters || (this.shadowCasters = []);
    out.length = 0;
    const consider = (obj) => {
      if (!obj) return;
      const u = obj.userData;
      let vis = obj.visible;
      for (let p = obj.parent; vis && p; p = p.parent) vis = p.visible;
      const pos = obj.position;
      const changed = vis !== u.shadowVis
        || (vis && (Math.abs(pos.x - u.shadowX) > 0.01 || Math.abs(pos.z - u.shadowZ) > 0.01
          || Math.abs(obj.rotation.y - u.shadowR) > 0.01 || u.poseDirty || u.walking));
      if (!changed) return;
      out.push(pos);
      u.shadowVis = vis;
      u.shadowX = pos.x;
      u.shadowZ = pos.z;
      u.shadowR = obj.rotation.y;
      u.poseDirty = false;
    };
    // The passengers are not here: they are translucent and throw no shadow.
    consider(this.attendant?.figure);
    consider(this.presence?.figure);
    consider(this.presence?.thing);
    for (const obj of this.extraShadowCasters ?? []) consider(obj);
    return out;
  }

  // A tier change (from the governor or the settings) re-dials every
  // expensive feature; a scale change is only a resize.
  onQualityChange(tier, reason) {
    if (reason !== 'scale') {
      this.ps1.applyTier(tier);
      setAnisotropy(Math.min(tier.anisotropy, this.maxAnisotropy));
      setBigTextures(tier.bigTextures);
      const fs = this.player.flashlight.shadow;
      if (fs.mapSize.x !== tier.flashShadowSize) {
        fs.mapSize.set(tier.flashShadowSize, tier.flashShadowSize);
        fs.map?.dispose();
        fs.map = null;
      }
      this.atmosphere?.applyTier(tier);
    }
    this.resize();
  }

  updateLights(dt, t, p) {
    // Decays each frame; the Attendant re-asserts it while he is close.
    this.attendantLightDrain = Math.max(0, (this.attendantLightDrain ?? 0) - dt * 1.5);
    // Only a handful of lights stay enabled; forward rendering gets expensive
    // fast and the station has thirty fixtures. They go to the lights the
    // player can actually see first. Line of sight is checked to the floor
    // around each fixture, not just to the tube: a room seen through a
    // doorway is lit even when its tube is hidden behind the lintel, which is
    // what used to leave every side room a black void from the hall.
    this.lightSightTimer = (this.lightSightTimer ?? 0) - dt;
    if (this.lightSightTimer <= 0) {
      this.lightSightTimer = 0.25;
      const cols = this.level.colliders;
      for (const l of this.level.lights) {
        const lx = l.light.position.x;
        const lz = l.light.position.z;
        if ((lx - p.x) ** 2 + (lz - p.z) ** 2 > 900) {
          l.seen = false;
          continue;
        }
        let seen = !segmentBlocked(cols, p.x, p.z, lx, lz);
        for (let k = 0; !seen && k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.4;
          const ox = lx + Math.cos(a) * 2.6;
          const oz = lz + Math.sin(a) * 2.6;
          if (roomAt(ox, oz) !== l.room) continue;
          seen = !segmentBlocked(cols, p.x, p.z, ox, oz);
        }
        l.seen = seen;
      }
    }
    const sorted = this.lightOrder || (this.lightOrder = this.level.lights.map((l) => ({ l, d: 0, score: 0 })));
    for (const e of sorted) {
      e.d = (e.l.light.position.x - p.x) ** 2 + (e.l.light.position.z - p.z) ** 2;
      e.score = e.d * (e.l.seen ? 1 : 6);
    }
    sorted.sort((a, b) => a.score - b.score);

    // A dead fixture does not take one of the slots. Keeping the number of
    // enabled lights constant also keeps every shader on one variant: a dead
    // light inside the budget used to drop the count and recompile the lot.
    // A cutscene lamp that is on takes one of the slots, so the total never
    // changes (and neither does any shader).
    const tier = this.quality.tier;
    const maxLights = tier.maxLights - Math.min(this.sets?.reserved ?? 0, tier.maxLights - tier.shadowBudget);
    let used = 0;
    for (const entry of sorted) {
      const light = entry.l;
      // A blackout is a scare, not damage: the light is off for a few seconds
      // and nothing else about it changes, so no rule treats the room as dark.
      if (light.blackout > 0) light.blackout = Math.max(0, light.blackout - dt);
      const active = !light.broken && used < maxLights;
      if (active) used++;
      light.light.visible = active;
      light.fixture.visible = !light.broken && entry.d < 1600;

      if (!active) {
        // On, but out of the forward budget: a steady tube, not one frozen
        // at whatever flicker it was caught on.
        if (!light.broken) light.tube.material.color.setScalar(light.blackout > 0 ? 0.05 : 0.85);
        continue;
      }
      const intensity = this.lightIntensity(light, t);
      light.light.intensity = intensity;
      // Only the tube brightens and dims. The housing around it is painted
      // steel and stays painted steel no matter what the tube is doing.
      light.tube.material.color.setScalar(light.blackout > 0 && intensity === 0
        ? 0.05
        : 0.4 + Math.min(1, intensity / light.base) * 0.6);
    }
  }

  // How bright a fixture is right now: its flicker, the night wearing on, a
  // blackout, and him pulling the light out of the room around him.
  lightIntensity(light, t) {
    let intensity = light.base;
    if (light.flicker > 0) {
      const n = Math.sin(t * 13 + light.phase) * Math.sin(t * 2.7 + light.phase * 1.7);
      const dropout = Math.random() < light.flicker * 0.02 ? 0.15 : 1;
      intensity *= (1 - light.flicker * 0.35 + light.flicker * 0.35 * n) * dropout;
    }
    // Everything dims as the night goes on.
    intensity *= 1 - this.clock.progress * 0.25;
    if (light.blackout > 0) {
      // Coming back on, it stutters for the last half second.
      intensity = light.blackout < 0.5 && Math.random() < 0.5 ? intensity * 0.6 : 0;
    }

    // He pulls the light out of the room around him.
    const drain = this.attendantLightDrain ?? 0;
    if (drain > 0.01) {
      const dl = Math.hypot(
        light.light.position.x - this.attendant.position.x,
        light.light.position.z - this.attendant.position.z
      );
      if (dl < 10) {
        const pull = drain * (1 - dl / 10);
        intensity *= 1 - pull * 0.75 * (Math.random() < 0.25 ? 2.2 : 1);
      }
    }
    return Math.max(0, intensity);
  }

  // The CRTs are a live feed, not a menu: you can see him move between rooms
  // from across Security without ever pressing a key.
  updateMonitors(dt) {
    this.monitorTimer = (this.monitorTimer ?? 0) - dt;
    if (this.monitorTimer > 0) return;
    this.monitorTimer = 0.5;
    const d = Math.hypot(this.player.position.x - 17.2, this.player.position.z + 2.6);
    if (d > 20) return;
    this.cameraViews = this.describeCameras();
    this.refs.monitors?.redraw();
  }

  // Answering it is always a mistake, and the game lets you make it.
  onPhoneAnswered() {
    this.audio.deafen(2.6);
    this.fear.kick('aberration', 1.2);
    this.fear.wantFear(0.75);
    this.subtitle('You hear this room. Your own breathing, half a second late.', 4);
    this.later(2.6, () => {
      this.audio.whisper(0, 0.9);
      this.subtitle(`The line says your name. "${this.playerName}. Stay where you are."`, 4);
      this.fear.jolt(0.8);
    });
    this.later(5.2, () => {
      // He knows exactly where you are now, because you told him.
      this.makeNoise(this.player.position.x, this.player.position.z, 1.0, 'you answer the phone');
      this.note('Station', 'Answering the payphone tells him which room you are in.');
    });
  }

  updateFogAndRoom(dt) {
    const room = roomAt(this.player.position.x, this.player.position.z);
    this.currentRoom = room;
    this.audio.setSpace(room ?? 'outside');

    // Fog rolls in at the bays and is thickest in the tunnel.
    this.atmosphere.updateFog(room, this.fear.fear, dt);

    // Dark areas, for the false flashlight rule.
    let total = 0;
    let lit = 0;
    for (const l of this.level.lights) {
      if (l.room !== room) continue;
      total++;
      if (!l.broken) lit++;
    }
    this.inDark = this.level.darkRooms.has(room) || (total > 0 && lit === 0);
  }

  updateBoardStare(dt) {
    const board = this.boardMesh;
    if (!board) return;
    const origin = this.camera.position;
    this.camera.getWorldDirection(_dir);
    _to.subVectors(board.position, origin);
    const dist = _to.length();
    const aim = _to.normalize().dot(_dir);

    const looking = dist < 14 && aim > 0.955 &&
      !segmentBlocked(this.level.colliders, origin.x, origin.z, board.position.x, board.position.z);

    if (looking) {
      this.boardStare += dt;
      // Something reading every row as the same departure gives you nothing
      // to learn from it.
      if (this.boardStare > 10 && !this.boardRevealed && !this.presence.boardWrong) {
        this.boardRevealed = true;
        this.refs.board?.redraw();
        this.audio.splitFlap(20);
        this.learnLockerCode(this.lockerInitials());
        this.subtitle('The slats cycle again. The cancelled routes spell something.', 5);
      }
    } else {
      this.boardStare = Math.max(0, this.boardStare - dt * 0.6);
    }
  }

  updateHUD(dt) {
    this.touch?.update();
    this.hud.el.hud.classList.toggle('watching', !!this.player.watching);
    this.hud.el.hud.classList.toggle('inspecting', !!this.player.inspecting);
    this.hud.el.hud.classList.toggle('transitioning', !!this.transitioning);
    this.hud.setClock(this.clock.label);
    this.hud.tick(dt);

    // Prompt priority: an active challenge, then the thing you are looking at.
    let reticle = 'idle';
    if (this.hud.modalOpen || this.transitioning || this.ended || this.cutscene) {
      this.hud.setPrompt('');
      reticle = 'hidden';
    } else if (this.challenge) {
      this.hud.setPrompt(this.challenge.prompt);
    } else if (this.player.hiding) {
      this.hud.setPrompt(`Hidden ${this.player.hiding.name}<span class="sep"></span><kbd>SPACE</kbd> hold breath<span class="sep"></span><kbd>Q</kbd> leave`);
      reticle = 'hidden';
    } else if (this.player.watching) {
      const f = this.player.watching.focus;
      const what = f >= 0 ? `CAM ${f + 1}  ${this.cctv.label(f)}` : 'ALL CAMERAS';
      // On a touchscreen the buttons say all of it, and a prompt along the
      // bottom would run under them.
      this.hud.setPrompt(this.touch ? '' : `${what}<span class="sep"></span><kbd>A</kbd> <kbd>D</kbd> switch camera<span class="sep"></span><kbd>E</kbd> stand up`);
      reticle = 'hidden';
    } else if (this.player.inspecting) {
      const ins = this.player.inspecting;
      this.hud.setPrompt(this.touch || ins.leaving ? '' : `${ins.target.label}<span class="sep"></span><kbd>SCROLL</kbd> lean closer<span class="sep"></span><kbd>E</kbd> back`);
      reticle = 'hidden';
    } else {
      const target = this.bestInteractable();
      if (target?.spot) {
        this.hud.setPrompt(`<kbd>E</kbd> ${target.spot.promptName}`);
        reticle = 'target';
      } else if (target?.it) {
        this.hud.setPrompt(`<kbd>E</kbd> ${target.it.prompt()}`);
        reticle = 'target';
      } else {
        this.hud.setPrompt('');
      }
    }
    this.hud.setReticle(reticle);

    this.hud.setBreath(this.player.breath, !!this.player.hiding, this.player.holdingBreath);

    const run = this.state.run;
    this.hud.setInventory({
      coins: run.coins,
      ticket: [run.ticketStub, run.ticketStamped, run.ticketPunched],
      keyring: run.hasKeyring,
      punch: run.hasPunch,
      walkie: run.hasWalkie,
      // Below a quarter the battery reads red. The torch is the only thing
      // between the player and a room they cannot read, and running it flat
      // without warning is not a fair surprise.
      torch: run.hasFlashlight ? {
        pct: Math.round(this.player.battery * 100),
        on: this.player.flashlightOn,
        low: this.player.battery < 0.25,
        cells: run.cells,
        canSwap: run.cells > 0 && this.player.battery < 0.9,
      } : null,
      carrying: this.carrying?.item ?? null,
      heard: this.state.persistent.heardStories.length,
      total: PASSENGERS.length,
    });
  }

  // Before BEGIN, the title sits over the station itself: a slow drift down
  // the hall toward the departure board, under the real lights.
  updateAttract(dt, t) {
    const a = t * 0.045;
    const x = Math.sin(a) * 3.2;
    const z = 6.5 + Math.cos(a * 0.7) * 1.5;
    this.camera.position.set(x, 1.62 + Math.sin(t * 0.3) * 0.03, z);
    this.camera.lookAt(x * 0.35, 2.1 + Math.sin(a * 0.5) * 0.25, -9);
    this.player.position.set(x, 0, z);
    for (const echo of this.echoes.list) {
      if (echo.seated) continue;
      const dx = x - echo.position.x;
      const dz = z - echo.position.z;
      echo.figure.rotation.y = Math.atan2(-dx, -dz);
    }
    this.updateLights(dt, t, this.camera.position);
    this.atmosphere.updateFog('hall', 0, dt);
    this.atmosphere.update(dt, t);
    this.ps1.updateShadowBudget(this.camera.position, dt, this.collectShadowCasters());
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(rawDt, 0.05);
    const t = now / 1000;

    this.pad.update(Math.min(rawDt, 0.1));

    if (!this.started) {
      this.updateAttract(dt, t);
      this.fear.update(dt);
      this.ps1.apply(this.fear, this.settings.calm);
      this.people.update(this.camera);
      this.ps1.render(this.scene, this.camera, t);
      return;
    }

    const frozen = this.hud.modalOpen || this.transitioning || this.ended || !!this.cutscene;
    // Only frames of actual play are evidence about the device.
    this.quality.sample(rawDt, !frozen && !document.hidden);

    if (this.cutscene && !this.hud.modalOpen) this.updateCutscene(dt, t);

    if (!frozen) this.stepWorld(dt, t);

    // Deliberately outside the frozen check. The catch, the endings and the
    // loop reset all happen with the simulation stopped, and they are exactly
    // the moments that need the screen to still be doing something.
    this.presence.tickFace(dt);
    this.fear.update(dt);
    this.huntIntensity = this.fear.fear;
    this.ps1.apply(this.fear, this.settings.calm);
    this.audio.setMood(this.fear.fear, this.fear.tension);
    this.ambience.update();

    if (!this.cutscene) this.updateFov(dt);
    this.updateHUD(dt);
    // Every rig has its pose for the frame; hand them to the bodies.
    this.people.update(this.camera);
    this.ps1.render(this.scene, this.camera, t);
    // After the frame, so the light slots and shadow maps it borrows are
    // already settled for the player's own view.
    if (!frozen && !document.hidden) this.cctv.render();
  }

  // One step of the world with nothing over it: everything that moves,
  // decides or breaks a rule. Separate from the frame so that a test can run
  // the night faster than it can be drawn.
  stepWorld(dt, t) {
    this.tickTimers(dt);
    this.player.update(dt);
    this.level.update(dt);
    for (const fn of this.refs.animated) fn(dt);

    const result = this.clock.update(dt, this);
    if (result === 'departure' && !this.state.run.boarded) this.onDeparted();

    this.attendant.update(dt, this.player, this.clock);
    this.echoes.update(dt, this.player, t);
    this.throwables.update(dt, this.player);
    this.director.update(dt, this.player, this.clock);
    this.presence.update(dt, this.player, t);
    this.cctv.update(dt);
    if (this.player.watching && this.camera4Active && this.cctv.thing.visible) this.onSawCamera4();

    if (this.blackoutHold > 0) {
      this.blackoutHold -= dt;
      this.fear.kick('blackout', 1);
    }

    // Challenge windows expire.
    if (this.challenge) {
      this.challenge.until -= dt;
      if (this.challenge.until <= 0) {
        const c = this.challenge;
        this.challenge = null;
        c.onExpire?.();
      }
    }

    this.updateBoardStare(dt);
    this.updateFogAndRoom(dt);

    // Rule checks run after everything that could break one.
    const broken = this.rules.update(dt, {
      player: this.player,
      clock: this.clock,
      state: this.state,
      game: this,
    });
    this.answeredPA = false;
    this.toldWrongTime = false;

    if (broken) {
      this.subtitle(broken.broke ?? 'A rule was broken.', 4);
      this.makeNoise(this.player.position.x, this.player.position.z, 1.0, 'you break a rule');
      this.note('Rules', `REAL RULE: ${broken.text}`);
      this.audio.cutHum(0.8);
    }

    // Pressure. How close he is, and whether he is actively coming for you,
    // are the two things the whole presentation layer keys off.
    const dist = Math.hypot(
      this.attendant.position.x - this.player.position.x,
      this.attendant.position.z - this.player.position.z
    );
    const hunting = this.attendant.state === 'hunt';
    const visible = this.attendant.lastSeenByPlayer;
    // A chase is frightening because it escalates, not because it is loud:
    // even a hunt scales with how close he actually is, and 1.0 stays
    // reserved for the catch and the set pieces.
    const closeness = 1 - Math.min(1, dist / 18);
    this.fear.wantFear(hunting
      ? 0.42 + closeness * 0.53
      : Math.max(0, 1 - dist / 14) * (visible ? 0.75 : 0.45));
    // The night itself gets heavier whether or not he is near.
    this.fear.wantTension(0.15 + this.clock.progress * 0.55);
    if (this.inDark) this.fear.wantTension(0.45 + this.clock.progress * 0.4);

    this.heartTimer = (this.heartTimer ?? 0) - dt;
    if (this.fear.fear > 0.22 && this.heartTimer <= 0) {
      // 62bpm at rest climbing to ~147 when he is on you.
      this.heartTimer = 60 / (62 + this.fear.fear * 85);
      this.audio.heartbeat(this.fear.fear);
      if (this.fear.fear > 0.5) this.pad?.pulse(this.fear.fear);
    }

    // For the length of a record the hall is deaf both ways: his keys and
    // his breathing drop under the music.
    if (this.attendant.emitter) this.attendant.emitter.volume = this.jukeboxDeafens() ? 0.12 : 0.9;

    this.audio.setListener(this.player.position.x, this.player.position.z, this.player.yaw);
    this.audio.updateEmitters((x, z) =>
      segmentBlocked(this.level.colliders, x, z, this.player.position.x, this.player.position.z)
    );

    this.updateLights(dt, t, this.player.position);
    // Hand the shadow budget to whatever is nearest and still burning, and
    // redraw the cached maps of any light something has moved under.
    this.ps1.updateShadowBudget(this.player.position, dt, this.collectShadowCasters());
    this.atmosphere.update(dt, t);
    this.updateMonitors(dt);
    // The hands move a few pixels a second; repainting and re-uploading
    // the face every frame bought nothing.
    const clockStep = Math.floor(this.clock.time * 4);
    if (clockStep !== this.lastClockStep) {
      this.lastClockStep = clockStep;
      this.refs.wallClock?.redraw();
    }
    // The board's own clock turns over once a minute.
    const minute = Math.floor(this.clock.time);
    if (minute !== this.lastBoardMinute) {
      this.lastBoardMinute = minute;
      this.refs.board?.redraw();
    }
  }

  onFootstep(loudness) {
    this.director?.onPlayerStep(loudness);
    const room = this.currentRoom;
    const surface = room && ROOMS[room]?.surface === 'concrete' ? 'concrete' : 'tile';
    this.audio.footstep(loudness, surface);
  }
}

// Said plainly, rather than left as a black page, when the browser cannot
// draw the game at all: WebGL off, hardware acceleration disabled, a locked-
// down machine.
function cannotRun(err) {
  console.error(err);
  const title = document.getElementById('title');
  // Nothing on the menu works without the game behind it.
  for (const el of title?.querySelectorAll('nav, .foot, #loadbar, #progressline') ?? []) el.classList.add('hidden');
  const p = document.createElement('p');
  p.className = 'fatal';
  p.innerHTML = 'Your browser could not start the game\'s 3D graphics (WebGL). '
    + 'Turn on <b>hardware acceleration</b> in the browser\'s settings, or try another browser '
    + '(Chrome, Edge, Firefox or Safari, up to date), then reload the page.';
  title?.querySelector('.title-inner')?.appendChild(p);
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.__game = new Game();
  } catch (err) {
    cannotRun(err);
  }
});
