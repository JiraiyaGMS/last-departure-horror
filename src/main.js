import * as THREE from 'three';
import { Level, roomAt, ROOMS } from './level.js';
import { furnish } from './furnish.js';
import { Player } from './player.js';
import { Attendant } from './attendant.js';
import { Echoes } from './echoes.js';
import { LoopClock, formatTime } from './loop.js';
import { RuleEngine } from './rules.js';
import { Fear } from './fear.js';
import { Director } from './director.js';
import { Presence } from './presence.js';
import { GameState } from './state.js';
import { AudioEngine } from './audio.js';
import { RenderPipeline, DESIGN_ASPECT } from './render.js';
import { setAnisotropy } from './textures.js';
import { HUD } from './ui/hud.js';
import { segmentBlocked } from './collision.js';
import { BOARD_ROUTES, PA_LINES, ENDINGS, PASSENGERS, LOCKER_CODE } from './content.js';

const MAX_ACTIVE_LIGHTS = 6;

class Game {
  constructor() {
    this.hud = new HUD();
    this.state = new GameState();
    this.audio = new AudioEngine();
    this.clock = new LoopClock();
    this.rules = new RuleEngine(this);
    this.fear = new Fear();
    this.playerName = 'PASSENGER';

    this.carrying = null;
    this.boardStare = 0;
    this.boardRevealed = false;
    this.mirrorRevealing = false;
    this.inDark = false;
    this.answeredPA = false;
    this.toldWrongTime = false;
    this.challenge = null;
    this.timeChallenge = null;
    this.cameraViews = [];
    this.boardRows = BOARD_ROUTES.slice();
    this.ruleSignRows = [];
    this.transitioning = false;
    this.started = false;
    this.ended = false;
    this.huntIntensity = 0;

    this.initRenderer();
    this.initWorld();
    this.initEvents();
    this.initInput();

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
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Native resolution, but capped: beyond 2x the cost is real and the gain
    // on a dim interior is not.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x05080a, 1);

    // Must happen before any texture is baked. Almost every surface in the
    // station is seen at a grazing angle down a long corridor, which is exactly
    // the case isotropic filtering turns into a shimmering mess.
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    // Exponential fog holds depth far better than linear in a corridor, and
    // keeps the far end of the hall genuinely unreadable rather than merely
    // tinted.
    this.scene.fog = new THREE.FogExp2(0x070b0b, 0.038);

    this.camera = new THREE.PerspectiveCamera(68, DESIGN_ASPECT, 0.08, 160);
    this.scene.add(this.camera);

    // Flat ambient is the cheap way to stop the darks crushing, but it pays for
    // that by flattening every surface it touches -- it would quietly undo the
    // shadows and AO the rest of the pipeline just bought. So it is kept to a
    // sliver, purely as a floor under absolute black.
    this.ambient = new THREE.AmbientLight(0x1a2a26, 0.18);
    this.scene.add(this.ambient);

    // The fill light proper. A hemisphere approximates the one bounce that
    // matters indoors: fluorescent light off a white ceiling coming down, and
    // almost nothing coming back up off dirty vinyl. Because it arrives from
    // above it still shades a surface by its normal, so geometry keeps its form
    // in the parts of the room no fixture reaches.
    this.hemi = new THREE.HemisphereLight(0x4a6f64, 0x0b1210, 1.5);
    this.scene.add(this.hemi);

    this.ps1 = new RenderPipeline(this.renderer, this.scene, this.camera);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.ps1?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.presence?.resizeFace(this.camera.aspect);
  }

  initWorld() {
    this.level = new Level();
    this.level.buildShell();
    this.refs = furnish(this.level, this);
    this.scene.add(this.level.group);
    this.setupShadowCasting();

    this.player = new Player(this.camera, this.level, this);
    this.player.teleport(-3.2, 6, 0);

    this.attendant = new Attendant(this.level, this);
    this.echoes = new Echoes(this.level, this);
    this.presence = new Presence(this);
    this.director = new Director(this);
  }

  // One traversal rather than a flag on every call site in furnish.js. The
  // only things excluded are the light fixtures themselves -- a glowing tube
  // that casts a shadow of its own housing looks broken -- and anything
  // already marked as not wanting them.
  setupShadowCasting() {
    this.level.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.noShadow) return;
      const m = o.material;
      // Emissive panels, screens and the tubes are sources, not occluders.
      const isSource = m && m.isMeshBasicMaterial;
      o.castShadow = !isSource;
      o.receiveShadow = !isSource;
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
        setTimeout(() => {
          if (this.ended) return;
          this.subtitle('The jukebox starts playing by itself.', 4);
          if (this.jukeEmitter) this.audio.playJukebox(this.jukeEmitter, 1);
          this.fear.jolt(0.5);
          this.note('Schedule', '12:30 — the jukebox starts on its own.');
        }, 3800);
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
        const inRestroom = this.currentRoom === 'restroom';
        if (inRestroom) {
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
        this.boardRows = this.boardRows.map((r) =>
          r.bay === 9 ? { ...r, status: 'BOARDING' } : r
        );
        this.refs.board?.redraw();
      });
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
    let held = 0;
    const hold = setInterval(() => {
      held += 0.1;
      if (this.ended || held > 2.6) {
        clearInterval(hold);
        return;
      }
      this.fear.kick('blackout', 1);
    }, 100);
    setTimeout(() => {
      if (this.ended || this.transitioning) return;
      this.presence.flashFace(4);
      this.fear.jolt(1);
    }, 3100);
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
    setTimeout(() => {
      if (this.ended || this.transitioning) return;
      if (this.currentRoom === 'cctv') {
        this.fear.jolt(1);
        this.audio.stinger();
        this.presence.flashFace(3);
        this.subtitle('It is closer to the lens than it was a second ago.', 4);
      }
    }, 5200);
  }

  initInput() {
    this.hud.el.startBtn.addEventListener('click', () => this.start());

    this.canvas.addEventListener('click', () => {
      if (!this.started || this.hud.modalOpen) return;
      this.canvas.requestPointerLock?.();
    });

    document.addEventListener('pointerlockchange', () => {
      this.player.lookEnabled = document.pointerLockElement === this.canvas;
    });

    window.addEventListener('keydown', (e) => {
      if (!this.started) return;

      if (e.code === 'Escape') {
        if (this.hud.readerOpen && !this.hud.hasChoices) this.hud.closeDocument();
        else if (this.hud.notebookOpen) this.hud.closeNotebook();
        return;
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.hud.readerOpen) return;
        const opened = this.hud.toggleNotebook(this.state.persistent.notes);
        if (opened) document.exitPointerLock?.();
        else this.canvas.requestPointerLock?.();
        return;
      }

      if (this.hud.readerOpen) {
        if (e.code === 'KeyE' && !this.hud.hasChoices) this.hud.closeDocument();
        return;
      }
      if (this.hud.notebookOpen || this.hud.endingOpen) return;

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
      if (e.code === 'Digit1' && this.challenge?.keys.Digit1) {
        this.challenge.keys.Digit1();
        this.challenge = null;
        return;
      }
      if (e.code === 'Digit2' && this.challenge?.keys.Digit2) {
        this.challenge.keys.Digit2();
        this.challenge = null;
        return;
      }
      if (e.code === 'KeyR') {
        if (this.challenge?.keys.KeyR) {
          this.challenge.keys.KeyR();
          this.challenge = null;
          return;
        }
        this.showTicket(true);
        return;
      }
    });
  }

  start() {
    this.started = true;
    this.hud.hideOverlay();
    this.audio.init();
    this.audio.resume();
    this.canvas.requestPointerLock?.();
    this.clock.start();

    // Attach the moving sound sources now that the context exists.
    this.attendant.attachAudio(this.audio);
    this.jukeEmitter = this.audio.makeEmitter(22.0, 8.3, 24);
    this.busEmitter = this.audio.makeEmitter(-22, -29, 34);
    this.audio.startDiesel(this.busEmitter);
    this.beltEmitter = this.audio.makeEmitter(11, 18.5, 18);
    this.beltEmitter.volume = 0.25;
    this.audio.startConveyor(this.beltEmitter);
    this.boardEmitter = this.audio.makeEmitter(0, -9.1, 26);

    this.subtitle('11:47 PM. You are awake, and the front doors open onto this same hall.', 6);
    this.note('Goal', 'Board the 3:33 AM bus at Bay 9 with a valid ticket: stub, stamp, punched transfer.');
  }

  // ---- helpers the world calls into --------------------------------------

  toast(text) {
    this.hud.toast(text);
  }

  subtitle(text, duration = 3.5) {
    this.hud.subtitle(text, duration);
  }

  note(category, text) {
    if (this.state.addNote(category, text)) {
      this.hud.toast('Written in your notebook.');
    }
  }

  showDocument(title, lines, choices = null) {
    document.exitPointerLock?.();
    this.hud.showDocument(title, lines, choices, () => {
      if (this.started && !this.hud.modalOpen) this.canvas.requestPointerLock?.();
    });
  }

  makeNoise(x, z, loudness, label) {
    this.attendant.hear(x, z, loudness, label);
    // Breaking a rule in front of a passenger is reported even if he is far.
    const echo = this.echoes.nearestWithin(new THREE.Vector3(x, 0, z), 6);
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
      prompt: 'The PA is asking you to respond. <b>[R]</b> answer &nbsp; <b>[do nothing]</b>',
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
      prompt: '<b>[1]</b> "It is 11:47." &nbsp;&nbsp; <b>[2]</b> Tell them the real time.',
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
    // Nothing happens, and the player gets to notice that nothing happened.
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

  onEnterHide(spot) {
    this.toast(`Hidden in ${spot.name}. SPACE holds your breath, Q leaves.`);
  }

  // ---- machines -----------------------------------------------------------

  watchMonitors() {
    const views = this.describeCameras();
    const anomalyCam = 4 - Math.min(3, this.state.persistent.sawCamera4);
    const lines = [
      'Four CRTs, three of them worth watching.',
      '',
      ...views.map((v, i) => {
        let row = `CAM ${i + 1}  ${v.label.padEnd(16, ' ')}`;
        if (v.attendant) row += '  FIGURE IN FRAME';
        if (v.anomaly) row += `  ${v.anomaly}`;
        return row;
      }),
      '',
    ];

    if (this.camera4Active) {
      lines.push(
        `On camera ${anomalyCam} there is a shape that the room it is pointed at does not contain.`,
        'It is not walking. Between frames it is simply nearer.',
        ''
      );
      if (!this.sawCamera4ThisLoop) {
        this.sawCamera4ThisLoop = true;
        this.state.persistent.sawCamera4++;
        this.state.save();
        this.note('Camera 4', `Loop ${this.state.persistent.loop}: the thing was on camera ${anomalyCam}. Each loop it is one camera closer.`);
        if (anomalyCam <= 1) {
          lines.push('Camera 1 is the waiting hall. Camera 1 is the room with the bench you wake up on.');
          this.note('Camera 4', 'It has reached camera 1. That is the hall where you wake up.');
        }
      }
    } else {
      lines.push('Camera 4 is pointed at something off the end of the service tunnel. It is dark.');
    }

    lines.push('The monitors are the only way to know where he is without hearing him.');
    this.showDocument('CCTV', lines);
    this.note('Security', 'The monitors in Security show where the Attendant is.');
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
          }
        },
      }))
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
          this.makeNoise(22.0, 8.3, 0.45, 'the jukebox');
          if (o.id === 'B3') {
            this.subtitle('The song is "Hollow Moon". The PA cuts in over it.', 5);
            setTimeout(() => {
              this.pa(PA_LINES.hiddenAnnouncement.join(' '));
              this.note('PA', 'Playing "Hollow Moon" makes the PA read a hidden announcement about the keyring.');
              this.note('Keyring', 'Walter is deaf to the jukebox. Play it and take the ring off the hook.');
            }, 1800);
          } else {
            this.subtitle('A warped tune fills the hall. Nothing answers it.', 4);
          }
        },
      }))
    );
  }

  useMirror() {
    if (!this.mirrorRevealing) {
      this.showDocument('The Mirror', [
        'Tarnished glass. You, in low light, from slightly the wrong angle.',
        '',
        'Behind your reflection the rules sign is visible on the far wall,',
        'reversed, and perfectly ordinary.',
        '',
        'Sister Ruiz said: after two in the morning.',
      ]);
      this.note('Rules', 'The restroom mirror only shows the truth after 2:00 AM.');
      return;
    }
    this.refs.mirror?.redraw();
    const revealed = [];
    for (const id of ['board_stare', 'flashlight_lit']) {
      if (this.state.markFakeRule(id)) revealed.push(id);
    }
    this.audio.cutHum(1.6);
    this.showDocument('The Mirror', [
      'In the glass, the sign on the far wall has two fewer rules than the wall does.',
      '',
      'FALSE:  "Do not look at the departure board for more than 10 seconds."',
      'FALSE:  "Keep your flashlight lit at all times in unlit areas."',
      '',
      'The other rules are in the same handwriting in both.',
      '',
      revealed.length
        ? 'You cross them off. Watch the board as long as you like. Keep the light off.'
        : 'You already knew.',
    ]);
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
          this.makeNoise(-13, 8.6, 0.4, 'the punch');
          this.toast(o.own ? 'Your own slip, punched.' : 'Slip punched.');
        },
      }))
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
      `You hold out the ${passenger.item.toLowerCase()}. They take it without touching you.`,
      '',
      ...passenger.story,
      '',
      `HEARD: ${heard} of ${total}`,
      heard >= total
        ? 'All of them have been heard. There is a new slip in the box in Lost & Found, and it has your name on it.'
        : 'The others are still waiting.',
    ]);
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
    return 'Board the 3:33 to the coast';
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
    this.state.run.boarded = true;
    this.triggerEnding(this.state.run.chosenSlip === 'self' ? 'home' : 'coast');
  }

  triggerEnding(id) {
    if (this.ended) return;
    this.ended = true;
    this.clock.paused = true;
    this.state.recordEnding(id);
    this.state.persistent.loop++;
    this.state.save();
    document.exitPointerLock?.();
    this.audio.cutHum(4);
    this.hud.fade(true);
    setTimeout(() => {
      this.hud.showEnding(
        ENDINGS[id],
        this.state.persistent.endingsSeen.length,
        Object.keys(ENDINGS).length,
        () => {
          this.hud.fade(false);
          this.ended = false;
          this.resetLoop(true);
        }
      );
    }, 700);
  }

  onCaught(reason) {
    if (this.transitioning || this.ended) return;
    this.transitioning = true;
    this.state.run.caught = true;
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
    }, 3000);
  }

  onDeparted() {
    // 3:33 came and went without you on the bus.
    if (this.transitioning || this.ended) return;
    this.transitioning = true;
    this.clock.paused = true;
    this.subtitle('3:33. Somewhere outside, a diesel engine pulls away without you.', 5);
    this.audio.cutHum(4);
    this.hud.fade(true);
    document.exitPointerLock?.();
    setTimeout(() => {
      this.state.persistent.loop++;
      this.state.save();
      this.resetLoop();
    }, 3200);
  }

  resetLoop(fromEnding = false) {
    this.state.newLoop();
    this.clock.reset();
    this.level.relockDoors();
    for (const light of this.level.lights) light.broken = false;
    for (const it of this.level.interactables) {
      it.enabled = true;
      it.onReset?.();
    }
    for (const spot of this.level.hideSpots) spot.occupied = false;
    this.player.teleport(-3.2, 6, 0);
    this.player.flashlightOn = false;
    this.player.battery = 1;
    this.attendant.reset();
    this.echoes.reset();
    this.fear.reset();
    this.director?.reset();
    this.presence?.reset();
    this.phoneRinging = false;
    this.carrying = null;
    this.boardStare = 0;
    this.boardRevealed = false;
    this.mirrorRevealing = false;
    this.camera4Active = false;
    this.sawCamera4ThisLoop = false;
    this.challenge = null;
    this.timeChallenge = null;
    this.boardRows = BOARD_ROUTES.slice();
    this.refs.board?.redraw();
    this.refs.mirror?.redraw();
    this.refreshSign();
    this.hud.setLoop(this.state.persistent.loop);
    this.audio.setHumLevel(0.085);
    this.hud.fade(false);
    this.transitioning = false;
    this.subtitle(
      fromEnding
        ? 'You wake up on the bench at 11:47 PM. The notebook is still in your pocket.'
        : 'You wake up on the bench. The clock says 11:47 PM. Your notebook is still full.',
      6
    );
    if (!this.hud.modalOpen) this.canvas.requestPointerLock?.();
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
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    let best = null;
    let bestScore = -Infinity;

    for (const it of this.level.interactables) {
      if (!it.enabled) continue;
      const to = new THREE.Vector3().subVectors(it.position, origin);
      const dist = to.length();
      if (dist > it.radius) continue;
      to.normalize();
      const aim = to.dot(dir);
      if (aim < 0.6) continue;
      const score = aim * 2 - dist * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }

    // Hiding spots compete with interactables for the prompt.
    let bestSpot = null;
    let bestSpotDist = 1.7;
    if (!this.player.hiding) {
      for (const spot of this.level.hideSpots) {
        if (spot.occupied) continue;
        const d = spot.position.distanceTo(this.player.position);
        if (d < bestSpotDist) {
          bestSpotDist = d;
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

  updateLights(dt, t) {
    const p = this.player.position;
    // Decays each frame; the Attendant re-asserts it while he is close.
    this.attendantLightDrain = Math.max(0, (this.attendantLightDrain ?? 0) - dt * 1.5);
    // Only the nearest handful of lights stay enabled; forward rendering gets
    // expensive fast and the station has two dozen fixtures.
    const sorted = this.level.lights
      .map((l) => ({ l, d: (l.light.position.x - p.x) ** 2 + (l.light.position.z - p.z) ** 2 }))
      .sort((a, b) => a.d - b.d);

    sorted.forEach((entry, index) => {
      const light = entry.l;
      const active = index < MAX_ACTIVE_LIGHTS && !light.broken;
      light.light.visible = active;
      light.fixture.visible = !light.broken && entry.d < 1600;

      if (!active) return;
      let intensity = light.base;
      if (light.flicker > 0) {
        const n = Math.sin(t * 13 + light.phase) * Math.sin(t * 2.7 + light.phase * 1.7);
        const dropout = Math.random() < light.flicker * 0.02 ? 0.15 : 1;
        intensity *= (1 - light.flicker * 0.35 + light.flicker * 0.35 * n) * dropout;
      }
      // Everything dims as the night goes on.
      intensity *= 1 - this.clock.progress * 0.25;

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
      light.light.intensity = Math.max(0, intensity);
      // Only the tube brightens and dims. The housing around it is painted
      // steel and stays painted steel no matter what the tube is doing.
      light.tube.material.color.setScalar(0.4 + Math.min(1, intensity / light.base) * 0.6);
    });
  }

  // The CRTs are a live feed, not a menu: you can see him move between rooms
  // from across Security without ever pressing a key.
  updateMonitors(dt) {
    this.monitorTimer = (this.monitorTimer ?? 0) - dt;
    if (this.monitorTimer > 0) return;
    this.monitorTimer = 0.55;
    const d = Math.hypot(this.player.position.x - 17, this.player.position.z + 3.9);
    if (d > 24) return;
    this.cameraViews = this.describeCameras();
    this.refs.monitors?.redraw();
  }

  // Answering it is always a mistake, and the game lets you make it.
  onPhoneAnswered() {
    this.audio.deafen(2.6);
    this.fear.kick('aberration', 1.2);
    this.fear.wantFear(0.75);
    this.subtitle('You hear this room. Your own breathing, half a second late.', 4);
    setTimeout(() => {
      if (this.ended || this.transitioning) return;
      this.audio.whisper(0, 0.9);
      this.subtitle(`The line says your name. "${this.playerName}. Stay where you are."`, 4);
      this.fear.jolt(0.8);
    }, 2600);
    setTimeout(() => {
      if (this.ended || this.transitioning) return;
      // He knows exactly where you are now, because you told him.
      this.makeNoise(this.player.position.x, this.player.position.z, 1.0, 'you answer the phone');
      this.note('Station', 'Answering the payphone tells him which room you are in.');
    }, 5200);
  }

  updateFogAndRoom() {
    const room = roomAt(this.player.position.x, this.player.position.z);
    this.currentRoom = room;

    const def = room ? ROOMS[room] : null;
    let near = 3;
    let far = 30;
    if (room === 'bays' || room === 'bay0') {
      near = 1.5;
      far = 19; // fog rolls in at the bays
    } else if (room === 'tunnel') {
      near = 0.5;
      far = 11;
    }
    this.scene.fog.near += (near - this.scene.fog.near) * 0.06;
    this.scene.fog.far += (far - this.scene.fog.far) * 0.06;

    // Dark areas, for the false flashlight rule.
    const roomLights = this.level.lights.filter((l) => l.room === room);
    const anyLit = roomLights.some((l) => !l.broken);
    this.inDark = this.level.darkRooms.has(room) || (roomLights.length > 0 && !anyLit);
  }

  updateBoardStare(dt) {
    const board = this.boardMesh;
    if (!board) return;
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const to = new THREE.Vector3().subVectors(board.position, origin);
    const dist = to.length();
    const aim = to.normalize().dot(dir);

    const looking = dist < 14 && aim > 0.955 &&
      !segmentBlocked(this.level.colliders, origin.x, origin.z, board.position.x, board.position.z);

    if (looking) {
      this.boardStare += dt;
      if (this.boardStare > 10 && !this.boardRevealed) {
        this.boardRevealed = true;
        this.refs.board?.redraw();
        this.audio.splitFlap(20);
        const initials = this.boardRows.filter((r) => r.status === 'CANCELLED').map((r) => r.dest[0]).join('');
        this.learnLockerCode(initials);
        this.subtitle('The slats cycle again. The cancelled routes spell something.', 5);
      }
    } else {
      this.boardStare = Math.max(0, this.boardStare - dt * 0.6);
    }
  }

  updateHUD(dt) {
    this.hud.setClock(this.clock.label);
    this.hud.tick(dt);

    // Prompt priority: an active challenge, then the thing you are looking at.
    if (this.challenge) {
      this.hud.setPrompt(this.challenge.prompt);
    } else if (this.player.hiding) {
      this.hud.setPrompt(`Hidden in ${this.player.hiding.name} &nbsp; <b>[SPACE]</b> hold breath &nbsp; <b>[Q]</b> leave`);
    } else {
      const target = this.bestInteractable();
      if (target?.spot) {
        this.hud.setPrompt(`<b>[E]</b> ${target.spot.promptName}`);
      } else if (target?.it) {
        this.hud.setPrompt(`<b>[E]</b> ${target.it.prompt()}`);
      } else {
        this.hud.setPrompt('');
      }
    }

    const showBreath = !!this.player.hiding;
    this.hud.setBreath(this.player.breath, showBreath);

    const run = this.state.run;
    const lines = [];
    lines.push(`<span class="${run.coins ? 'part' : 'dim'}">COINS ${run.coins}</span>`);
    const parts = ['STUB', 'STAMP', 'TRANSFER'];
    const have = [run.ticketStub, run.ticketStamped, run.ticketPunched];
    lines.push(parts.map((p, i) => `<span class="${have[i] ? 'part' : 'dim'}">${p}</span>`).join(' '));
    if (run.hasKeyring) lines.push('<span class="part">KEYRING</span>');
    if (run.hasPunch) lines.push('<span class="part">PUNCH</span>');
    if (run.hasFlashlight) {
      lines.push(`<span class="${this.player.flashlightOn ? 'part' : 'dim'}">TORCH ${Math.round(this.player.battery * 100)}%</span>`);
    }
    if (this.carrying) lines.push(`<span class="part">${this.carrying.item}</span>`);
    lines.push(`<span class="dim">HEARD ${this.state.persistent.heardStories.length}/${PASSENGERS.length}</span>`);
    this.hud.setInventory(lines);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    dt = Math.min(dt, 0.05);
    const t = now / 1000;

    if (!this.started) {
      this.ps1.render(this.scene, this.camera, t);
      return;
    }

    const frozen = this.hud.modalOpen || this.transitioning || this.ended;

    if (!frozen) {
      this.player.update(dt);

      const result = this.clock.update(dt, this);
      if (result === 'departure' && !this.state.run.boarded) this.onDeparted();

      this.attendant.update(dt, this.player, this.clock);
      this.echoes.update(dt, this.player, t);
      this.director.update(dt, this.player, this.clock);
      this.presence.update(dt, this.player, t);

      // Challenge windows expire.
      if (this.challenge) {
        this.challenge.until -= dt;
        if (this.challenge.until <= 0) {
          this.challenge.onExpire?.();
          this.challenge = null;
        }
      }

      this.updateBoardStare(dt);
      this.updateFogAndRoom();

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
      // A chase is frightening because it escalates, not because it is loud.
      // Pinning fear at maximum for the whole hunt spends the dynamic range
      // every other scare needs -- if the screen is already shaking as hard as
      // it can, his face on the lens is just more of the same. So even a hunt
      // scales with how close he actually is, and 1.0 stays reserved for the
      // catch and for the set pieces that explicitly jolt.
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
      }

      this.audio.setListener(this.player.position.x, this.player.position.z, this.player.yaw);
      this.audio.updateEmitters((x, z) =>
        segmentBlocked(this.level.colliders, x, z, this.player.position.x, this.player.position.z)
      );

      this.updateLights(dt, t);
      // Hand the shadow budget to whatever is nearest and still burning.
      this.ps1.updateShadowBudget(this.player.position);
      this.updateMonitors(dt);
      this.refs.wallClock?.redraw();
    }

    // Deliberately outside the frozen check. The catch, the endings and the
    // loop reset all happen with the simulation stopped, and they are exactly
    // the moments that need the screen to still be doing something.
    this.presence.tickFace(dt);
    this.fear.update(dt);
    this.huntIntensity = this.fear.fear;
    this.ps1.apply(this.fear);
    this.audio.setMood(this.fear.fear, this.fear.tension);

    this.updateHUD(dt);
    this.ps1.render(this.scene, this.camera, t);
  }

  onFootstep(loudness) {
    const room = this.currentRoom;
    const surface = room && ROOMS[room]?.surface === 'concrete' ? 'concrete' : 'tile';
    this.audio.footstep(loudness, surface);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__game = new Game();
});
