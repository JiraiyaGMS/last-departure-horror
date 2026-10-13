import * as THREE from 'three';
import { surface, tint, liveCanvas } from './textures.js';
import { ROOMS } from './level.js';
import { BOARD_ROUTES, DOCUMENTS, PASSENGERS, LOCKER_CODE } from './content.js';
import { makeBench, makePayphone, makeVending, makeBin, makeLockers, makeBelonging } from './props.js';

const PALETTE = {
  metal: 0x4a5257,
  darkMetal: 0x2b3135,
  rust: 0x7a4322,
  seatGreen: 0x2d5a4a,
  seatOrange: 0x8a4a22,
  wood: 0x4a3526,
  glass: 0x9fd8c8,
  paper: 0xbfae8e,
  screenGreen: 0x4dff9b,
};

export function furnish(level, game) {
  const refs = {
    boardMeshes: [],
    panels: [],
    monitors: null,
    board: null,
    wallClock: null,
    coins: [],
  };

  const mat = (o) => level.mat(o);

  // Brushed stainless for the fittings that get touched, flat paint for the
  // ones that do not.
  const metal = mat({ ...surface('steel', { metalness: 0.55, roughness: 0.9 }), color: tint('steel', 0x5d6266) });
  const darkMetal = mat({ color: PALETTE.darkMetal, roughness: 0.55, metalness: 0.35 });
  const woodMat = mat({ ...surface('wood'), color: tint('wood', 0x5c3d2a) });
  const seatA = mat({ ...surface('vinyl', { roughness: 0.85 }), color: tint('vinyl', 0x4f7a6c) });
  const seatB = mat({ ...surface('vinyl', { roughness: 0.85 }), color: tint('vinyl', 0x93613f) });
  // Painted sheet steel, worn back to bare metal at the edges. `hex` is the
  // paint colour the surface should average out to.
  const paint = (hex) => mat({ ...surface('paint', { metalness: 0.35 }), color: tint('paint', hex) });
  const paperMat = mat({ color: PALETTE.paper });

  function cyl(x, y, z, r, h, material, blocking = false) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 7), material);
    m.position.set(x, y + h / 2, z);
    level.group.add(m);
    if (blocking) level.addCollider(x - r, z - r, x + r, z + r, y + h);
    return m;
  }

  // A flat panel with painted text. `redraw` repaints it whenever needed.
  function textPanel(x, y, z, rotY, w, h, pxW, pxH, draw) {
    const live = liveCanvas(pxW, pxH);
    const material = new THREE.MeshBasicMaterial({ map: live.texture });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    level.group.add(mesh);
    const panel = {
      mesh,
      live,
      redraw: () => {
        draw(live.ctx, pxW, pxH);
        live.texture.needsUpdate = true;
      },
    };
    panel.redraw();
    refs.panels.push(panel);
    return panel;
  }

  // A crude boxy figure, painted into any canvas panel. Used for the shape in
  // the mirror and the shape on Camera 4 -- always a silhouette, never a face,
  // because the imagination fills it in worse than we could.
  function silhouette(ctx, cx, baseY, height, opts = {}) {
    const h = height;
    ctx.fillStyle = opts.color ?? 'rgba(4,6,9,0.92)';
    const w = h * 0.26;
    // legs
    ctx.fillRect(cx - w * 0.42, baseY - h * 0.42, w * 0.3, h * 0.42);
    ctx.fillRect(cx + w * 0.12, baseY - h * 0.42, w * 0.3, h * 0.42);
    // torso
    ctx.fillRect(cx - w / 2, baseY - h * 0.82, w, h * 0.42);
    // arms
    ctx.fillRect(cx - w * 0.72, baseY - h * 0.8, w * 0.2, h * 0.38);
    ctx.fillRect(cx + w * 0.52, baseY - h * 0.8, w * 0.2, h * 0.38);
    // head, tilted off true if asked
    const hw = w * 0.52;
    const tilt = opts.tilt ?? 0;
    ctx.save();
    ctx.translate(cx, baseY - h * 0.86);
    ctx.rotate(tilt);
    ctx.fillRect(-hw / 2, -h * 0.17, hw, h * 0.17);
    if (opts.eyes) {
      ctx.fillStyle = opts.eyeColor ?? 'rgba(220,240,230,0.85)';
      const ey = -h * 0.11;
      ctx.fillRect(-hw * 0.34, ey, Math.max(1, hw * 0.16), Math.max(1, h * 0.03));
      ctx.fillRect(hw * 0.18, ey, Math.max(1, hw * 0.16), Math.max(1, h * 0.03));
    }
    ctx.restore();
  }
  refs.silhouette = silhouette;

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(' ');
    let line = '';
    let cursorY = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        line = word;
        cursorY += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, cursorY);
    return cursorY + lineHeight;
  }

  function coin(id, x, y, z, hint) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.012, 8),
      mat({ color: 0xb8a460, emissive: 0x3a3112 })
    );
    mesh.position.set(x, y, z);
    mesh.rotation.x = Math.PI / 2;
    level.group.add(mesh);
    const it = level.addInteractable({
      id,
      position: new THREE.Vector3(x, y, z),
      radius: 1.9,
      prompt: () => 'Take coin (1987)',
      use: () => {
        game.state.run.coins++;
        mesh.visible = false;
        it.enabled = false;
        game.audio.coinDrop();
        game.toast(`1987 coin (${game.state.run.coins})`);
        game.note('Coins', hint);
      },
      onReset: () => {
        mesh.visible = true;
        it.enabled = true;
      },
    });
    refs.coins.push(it);
    return it;
  }

  // Spare cells for the torch. Deliberately placed one per far corner rather
  // than stocked anywhere convenient: the walk to the next pack is the real
  // price of having run the torch flat, and three of the four sit in rooms you
  // need something else to reach.
  function cellPack(id, x, y, z, hint) {
    const mesh = level.box(x, z, 0.16, 0.09, 0.09, y, mat({ color: 0x3a3a2a }), { ghost: true });
    const it = level.addInteractable({
      id,
      position: new THREE.Vector3(x, y + 0.05, z),
      radius: 1.9,
      prompt: () => 'Take spare cells',
      use: () => {
        game.state.run.cells++;
        mesh.visible = false;
        it.enabled = false;
        game.audio.paper();
        game.toast(`Spare cells (${game.state.run.cells})`);
        game.note('Items', hint);
        game.note('Items', 'Press B to put a fresh cell in the torch.');
      },
      onReset: () => {
        mesh.visible = true;
        it.enabled = true;
      },
    });
    return it;
  }

  function document(id, x, y, z, rotY, docKey, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.w ?? 0.5, opts.h ?? 0.36), paperMat);
    mesh.position.set(x, y, z);
    if (opts.flat) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rotY;
    } else {
      mesh.rotation.y = rotY;
    }
    level.group.add(mesh);
    return level.addInteractable({
      id,
      position: new THREE.Vector3(x, y, z),
      radius: opts.radius ?? 2.2,
      prompt: () => opts.prompt ?? 'Read',
      use: () => {
        const doc = DOCUMENTS[docKey];
        game.audio.paper();
        game.showDocument(doc.title, doc.lines(game.state.persistent.loop, game.playerName));
        opts.onRead?.();
      },
    });
  }

  // ---- Main Waiting Hall -------------------------------------------------

  (function hall() {
    const r = ROOMS.hall;

    // Bench rows. You can crouch under them to hide.
    const benchRows = [
      { z: 5.5, flip: false },
      { z: 2.0, flip: true },
      { z: -1.5, flip: false },
    ];
    for (const [i, row] of benchRows.entries()) {
      for (const bx of [-6.5, 0, 6.5]) {
        const seatMat = (i + (bx > 0 ? 1 : 0)) % 2 === 0 ? seatA : seatB;

        // Modelled rather than boxed. The gaps between the slats are what let
        // the flashlight throw stripes on the floor behind a bench, and they
        // are most of the reason you can tell at a glance that the shape in the
        // next row is furniture and not a person sitting down.
        const bench = makeBench(4.6, { wood: seatMat, metal: darkMetal });
        bench.position.set(bx, 0, row.z);
        if (row.flip) bench.rotation.y = Math.PI;
        level.group.add(bench);

        // Collision is still the old simple footprint: the seat is steppable so
        // it does not block movement outright, and the player hides underneath.
        level.addCollider(bx - 2.3, row.z - 0.35, bx + 2.3, row.z + 0.35, 0.56);

        level.addHideSpot({
          id: `hide_bench_${i}_${bx}`,
          name: 'under the bench',
          position: new THREE.Vector3(bx, 0, row.z),
          exit: new THREE.Vector3(bx, 0, row.z + (row.flip ? -1.4 : 1.4)),
          lookYaw: row.flip ? Math.PI : 0,
          quality: 0.75,
          promptName: 'Hide under bench',
        });
      }
    }

    // The departure board on the north wall.
    const boardFrame = level.box(0, -9.3, 7.2, 0.35, 2.6, 2.0, darkMetal, { ghost: true });
    refs.board = textPanel(0, 3.3, -9.1, 0, 7.0, 2.4, 256, 88, (ctx, w, h) => {
      ctx.fillStyle = '#07100c';
      ctx.fillRect(0, 0, w, h);
      ctx.font = 'bold 9px monospace';
      const rows = game.boardRows ?? BOARD_ROUTES;
      ctx.fillStyle = '#e8d070';
      ctx.fillText('DEPARTURES', 6, 11);
      ctx.fillText('BAY', 150, 11);
      ctx.fillText('STATUS', 180, 11);
      let y = 24;
      for (const row of rows.slice(0, 7)) {
        const cancelled = row.status === 'CANCELLED';
        ctx.fillStyle = cancelled ? '#d85a3a' : row.status.includes('AM') ? '#6bffb0' : '#cfc49a';
        ctx.fillText(row.dest.slice(0, 16), 6, y);
        ctx.fillText(String(row.bay), 152, y);
        ctx.fillText(row.status, 180, y);
        y += 9;
      }
      // The spelled code only surfaces once you have stared long enough.
      if (game.boardRevealed) {
        ctx.fillStyle = '#6bffb0';
        ctx.fillText('CANCELLED INITIALS: ' + LOCKER_CODE, 6, h - 5);
      }
    });
    refs.boardMeshes.push(refs.board.mesh);
    game.boardMesh = refs.board.mesh;

    level.addInteractable({
      id: 'int_departureboard',
      position: new THREE.Vector3(0, 2.6, -9.1),
      radius: 6,
      prompt: () => 'Study the departure board',
      use: () => {
        game.audio.splitFlap(10);
        const cancelled = (game.boardRows ?? BOARD_ROUTES).filter((r) => r.status === 'CANCELLED');
        const initials = cancelled.map((r) => r.dest[0]).join('');
        game.showDocument('Departure Board', [
          'Split-flap, half the slats stuck.',
          '',
          ...(game.boardRows ?? BOARD_ROUTES).map(
            (r) => `${r.dest.padEnd(16, ' ')} BAY ${r.bay}   ${r.status}`
          ),
          '',
          game.boardStare > 10
            ? `The cancelled destinations begin: ${initials}`
            : 'You would have to watch it cycle for a while to see a pattern.',
        ]);
        if (game.boardStare > 10) game.learnLockerCode(initials);
      },
    });

    // Wall clock, always readable from the hall.
    const clockPanel = textPanel(-8.5, 3.2, -9.1, 0, 1.6, 1.6, 64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d8d2c0';
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a1a18';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(32 + Math.sin(a) * 26, 32 - Math.cos(a) * 26);
        ctx.lineTo(32 + Math.sin(a) * 29, 32 - Math.cos(a) * 29);
        ctx.stroke();
      }
      const minutes = game.clock ? game.clock.time : 1427;
      const hourAngle = ((minutes / 60) % 12) * (Math.PI * 2 / 12);
      const minAngle = (minutes % 60) * (Math.PI * 2 / 60);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.sin(hourAngle) * 15, 32 - Math.cos(hourAngle) * 15);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.sin(minAngle) * 24, 32 - Math.cos(minAngle) * 24);
      ctx.stroke();
    });
    refs.wallClock = clockPanel;

    // Rules sign on the west wall.
    const signPanel = textPanel(-10.75, 2.0, -1.0, Math.PI / 2, 2.4, 3.0, 96, 120, (ctx, w, h) => {
      ctx.fillStyle = '#cfc6ac';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2a2620';
      ctx.fillRect(0, 0, w, 14);
      ctx.fillStyle = '#e8e2d0';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('STATION RULES', 8, 10);
      ctx.font = '6px monospace';
      let y = 24;
      const rows = game.ruleSignRows ?? [];
      for (const row of rows) {
        ctx.fillStyle = row.known ? '#9c2f20' : '#2a2620';
        y = wrapText(ctx, `${row.index}. ${row.text}`, 5, y, w - 10, 7) + 2;
        if (row.known) {
          ctx.fillStyle = '#9c2f20';
          ctx.fillRect(5, y - 10, w - 12, 1);
        }
      }
      ctx.fillStyle = '#5a5244';
      ctx.font = '5px monospace';
      ctx.fillText('GRAYHOLLOW TRANSIT CENTER', 6, h - 5);
    });
    refs.rulesSign = signPanel;

    level.addInteractable({
      id: 'int_rulessign',
      position: new THREE.Vector3(-10.6, 1.8, -1.0),
      radius: 2.6,
      prompt: () => 'Read the station rules',
      use: () => {
        game.audio.paper();
        const rows = game.ruleSignRows ?? [];
        game.showDocument('STATION RULES', [
          ...rows.map((r) => `${r.index}. ${r.text}${r.known ? '   [FALSE]' : ''}`),
          '',
          game.state.persistent.knownFakeRules.length
            ? 'You have crossed out the ones you know are lies.'
            : 'Some of these were not written by the same hand.',
        ]);
        game.note('Rules', 'The sign in the hall lists the station rules. Not all of them are real.');
      },
    });

    // Columns, bins, a dead plant.
    for (const cx of [-7.5, 7.5]) {
      for (const cz of [-7, 7]) cyl(cx, 0, cz, 0.45, r.h, woodMat, true);
    }
    // Waste bins. A tapered body with a rolled rim and a domed lid, because a
    // plain cylinder at this height reads as a bollard and the player keeps
    // walking into it expecting to pass.
    for (const [i, [bx, bz]] of [[-9.5, 8.5], [9.5, -8.5]].entries()) {
      const bin = makeBin({ metal, dark: darkMetal });
      bin.position.set(bx, 0, bz);
      // Spun off axis so the two do not look stamped from the same die. Fixed
      // rather than random: the station should be identical every reload.
      bin.rotation.y = 0.4 + i * 0.9;
      level.group.add(bin);
      level.addCollider(bx - 0.23, bz - 0.23, bx + 0.23, bz + 0.23, 0.86);
    }
    cyl(9.6, 0, 8.6, 0.4, 0.5, mat({ color: 0x3a2a1c }), true);
    refs.plant = cyl(9.6, 0.5, 8.6, 0.12, 1.1, mat({ color: 0x2f3a22 }));

    document('int_clipping', -9.0, 1.3, 7.0, Math.PI / 2, 'clipping', {
      prompt: 'Read newspaper clipping',
      w: 0.6, h: 0.45,
      onRead: () => {
        game.note('1987', 'A bus with 14 passengers left Bay 9 on Nov 3 1987 and never arrived.');
        if (game.state.persistent.loop >= 4) {
          game.note('1987', 'The photo in the clipping now shows someone on the bench wearing your clothes.');
        }
      },
    });

    coin('coin_hall', -6.5, 0.05, 5.5, 'Coins turn up under the hall benches.');

    // Payphone on the east wall. The line has been dead since 1987, which does
    // not stop it from ringing.
    (function payphone() {
      const px = 10.55;
      const pz = -1.0;

      // Modelled: keypad, coin box, cradle hooks and an armoured cord. The old
      // version was four boxes, and from two metres away it read as a fuse box.
      // A phone has to be recognisable as a phone from across the hall, because
      // the moment it rings you need to already know what the noise is.
      const unit = makePayphone({
        metal,
        dark: darkMetal,
        handset: mat({ color: 0x4a5056, roughness: 0.5 }),
        light: mat({ color: 0x9aa4a0 }),
      });
      unit.position.set(px, 1.5, pz);
      // Built facing +z; the east wall needs it looking back into the hall.
      unit.rotation.y = -Math.PI / 2;
      level.group.add(unit);
      level.addCollider(px - 0.2, pz - 0.3, px + 0.1, pz + 0.3, 2.0);

      const receiver = unit.userData.handset;
      const cord = unit.userData.cord;
      const hookPos = receiver.position.clone();
      const phone = {
        position: new THREE.Vector3(px, 1.5, pz),
        receiver,
        cord,
        offHook: false,
        setOffHook(v) {
          phone.offHook = v;
          if (v) {
            // Dangling on the end of the cord, turned off vertical. Local
            // space, so this is relative to the phone and the rotation on the
            // parent carries it round to the wall for free.
            receiver.position.set(hookPos.x, hookPos.y - 0.55, hookPos.z - 0.06);
            receiver.rotation.z = 0.25;
            cord.scale.y = 2.6;
          } else {
            receiver.position.copy(hookPos);
            receiver.rotation.z = 0;
            cord.scale.y = 1;
          }
        },
      };
      refs.payphone = phone;

      level.addInteractable({
        id: 'int_payphone',
        position: phone.position.clone(),
        radius: 2.2,
        prompt: () => (phone.offHook ? 'Hang up the receiver' : 'Lift the receiver'),
        use: () => {
          if (phone.offHook) {
            phone.setOffHook(false);
            game.audio.lockClick(true);
            return;
          }
          phone.setOffHook(true);
          game.audio.lockClick(false);
          if (game.phoneRinging) {
            game.phoneRinging = false;
            game.onPhoneAnswered?.();
            return;
          }
          game.subtitle('No dial tone. Just the room you are standing in, played back.', 4);
          game.note('Station', 'The payphone has no dial tone. It rings anyway.');
          setTimeout(() => {
            if (phone.offHook) game.audio.whisper(0, 0.5);
          }, 1400);
        },
        onReset: () => phone.setOffHook(false),
      });
    })();

    level.addLight(-5.5, r.h - 0.25, -5, { intensity: 0.95, distance: 15, room: 'hall' });
    level.addLight(5.5, r.h - 0.25, -5, { intensity: 0.95, distance: 15, room: 'hall' });
    level.addLight(-5.5, r.h - 0.25, 5, { intensity: 0.8, distance: 14, room: 'hall', flicker: 0.35 });
    level.addLight(5.5, r.h - 0.25, 5, { intensity: 0.8, distance: 14, room: 'hall' });
    level.addLight(0, r.h - 0.6, -8.4, { intensity: 0.6, distance: 9, room: 'hall', color: 0xe8d070, fixtureW: 6 });
  })();

  // ---- Ticket Office -----------------------------------------------------

  (function ticket() {
    // Counter along the hall wall.
    level.box(-13.4, -6, 1.0, 5.0, 1.05, 0, woodMat);
    level.box(-13.4, -6, 1.1, 5.0, 0.08, 1.05, darkMetal, { ghost: true });

    // Ticket machine.
    const machineBody = level.box(-21.0, -8.2, 1.0, 1.0, 1.9, 0, metal);
    const facePanel = textPanel(-21.0, 1.45, -7.68, 0, 0.8, 0.6, 48, 36, (ctx, w, h) => {
      ctx.fillStyle = '#10181a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = PALETTE.screenGreen;
      ctx.font = '6px monospace';
      const coins = game.state?.run.coins ?? 0;
      ctx.fillText('FARE: 4 COINS', 3, 10);
      ctx.fillText(`INSERTED: ${Math.min(coins, 4)}`, 3, 20);
      ctx.fillText(game.state?.run.ticketStub ? 'PRINTED' : 'READY', 3, 30);
    });

    level.addInteractable({
      id: 'int_ticketmachine',
      position: new THREE.Vector3(-21.0, 1.3, -7.6),
      radius: 2.4,
      prompt: () => {
        if (game.state.run.ticketStub) return 'The machine has already printed tonight';
        return `Insert coins (${Math.min(game.state.run.coins, 4)}/4)`;
      },
      use: () => {
        if (game.state.run.ticketStub) {
          game.toast('It will only print one stub a night.');
          return;
        }
        if (game.state.run.coins < 4) {
          game.audio.lockClick(false);
          game.toast(`It needs four 1987 coins. You have ${game.state.run.coins}.`);
          game.note('Ticket', 'The ticket machine needs exactly four 1987 coins.');
          return;
        }
        game.state.run.coins -= 4;
        game.state.run.ticketStub = true;
        game.showTicket();
        game.audio.vendingClunk();
        game.makeNoise(-21, -7.6, 0.8, 'the ticket machine');
        game.toast('A ticket stub, unstamped.');
        game.note('Ticket', 'Part 1 of 3: the stub, printed by the machine in the Ticket Office.');
      },
      redraw: facePanel.redraw,
    });

    // Walter's stamp drawer.
    level.box(-16.5, -4.0, 2.4, 0.9, 0.9, 0, woodMat);
    level.addInteractable({
      id: 'int_stampdrawer',
      position: new THREE.Vector3(-16.5, 0.9, -4.4),
      radius: 2.2,
      prompt: () =>
        game.state.run.ticketStamped
          ? 'The drawer is empty now'
          : game.state.run.hasKeyring
          ? 'Unlock the drawer and take the stamp'
          : 'Locked drawer (needs a keyring)',
      use: () => {
        if (game.state.run.ticketStamped) return;
        if (!game.state.run.hasKeyring) {
          game.audio.lockClick(false);
          game.toast("Locked. Walter keeps the ring on him, or on its hook.");
          game.note('Ticket', 'The destination stamp is in a locked drawer in the Ticket Office.');
          return;
        }
        if (!game.state.run.ticketStub) {
          game.toast('Nothing to stamp yet.');
          return;
        }
        game.state.run.ticketStamped = true;
        game.showTicket();
        game.audio.stamp();
        game.makeNoise(-16.5, -4.4, 0.45, 'the stamp');
        game.toast('Destination stamped: THE COAST.');
        game.note('Ticket', 'Part 2 of 3: the stamp, in the drawer. The keyring opens it.');
      },
    });

    document('int_nightlog', -16.5, 1.0, -4.0, 0, 'nightlog', {
      prompt: "Read Walter's night log",
      flat: true,
      onRead: () => {
        game.note('Walter', 'Walter Penn stamped all 14 tickets in 1987 and never boarded.');
        game.note('Rules', 'Walter writes that someone else has been adding rules to his sign.');
      },
    });

    // The fare manifest, left out on the counter where Walter took the fares.
    //
    // This is the quest-giver, so it is deliberately the easiest document in
    // the station to find: it is the only place the player learns there are
    // fourteen of them and what they are called. Walter's letter in the safe
    // tells you to hear all fourteen, but the safe is hours of play away, and
    // without this the ending reads as a secret rather than a goal.
    level.box(-13.7, -5.0, 0.3, 0.42, 0.012, 1.13, darkMetal, { ghost: true });
    document('int_manifest', -13.7, 1.148, -5.0, 0, 'manifest', {
      prompt: 'Read the fare manifest',
      flat: true,
      w: 0.26,
      h: 0.38,
      radius: 2.0,
      onRead: () => {
        game.note('Passengers', 'The manifest lists fourteen fares on the 11:47. Walter stamped every one.');
        game.note('Passengers', 'Line fourteen reads C. FERRY, seat 0. That coach has no seat 0, and the line is in a different hand.');
      },
    });

    // Filing cabinets.
    for (const fz of [-9.0, -8.0]) level.box(-12.2, fz, 0.7, 0.9, 1.4, 0, darkMetal);
    coin('coin_ticket', -16.5, 0.95, -3.6, 'There was a coin on the ticket desk.');

    level.addLight(-17, ROOMS.ticket.h - 0.25, -6, { intensity: 0.85, distance: 12, room: 'ticket', color: 0xd6e8c0 });

    // Door into the manager's office.
    level.addInteractable({
      id: 'int_managerdoor',
      position: new THREE.Vector3(-17, 1.3, -10),
      radius: 2.4,
      prompt: () =>
        game.state.run.hasKeyring ? "Unlock the manager's office" : "Manager's office (locked)",
      use: () => {
        if (!game.state.run.hasKeyring) {
          game.audio.lockClick(false);
          game.toast('Locked. A staff door.');
          return;
        }
        if (level.unlockDoor('managerDoor')) {
          game.audio.lockClick(true);
          game.toast("The manager's office is open.");
          game.note('Station', "The keyring opens the manager's office behind the Ticket Office.");
        }
      },
    });
  })();

  // ---- Manager's Office --------------------------------------------------

  (function manager() {
    level.box(-17, -16, 2.6, 1.2, 0.8, 0, woodMat);
    for (const sx of [-22.0, -12.0]) level.box(sx, -14, 0.5, 4, 2.2, 0, darkMetal);

    // The stopped clock. Setting it to 11:47 opens the floor safe.
    let clockSet = false;
    const stopped = textPanel(-17, 1.9, -19.6, 0, 1.2, 1.2, 48, 48, (ctx, w, h) => {
      ctx.fillStyle = '#c8c0ae';
      ctx.beginPath();
      ctx.arc(24, 24, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#201c18';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Frozen at 2:10 until set.
      const hourAngle = clockSet ? (11.78 / 12) * Math.PI * 2 : (2.17 / 12) * Math.PI * 2;
      const minAngle = clockSet ? (47 / 60) * Math.PI * 2 : (10 / 60) * Math.PI * 2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(24, 24);
      ctx.lineTo(24 + Math.sin(hourAngle) * 11, 24 - Math.cos(hourAngle) * 11);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 24);
      ctx.lineTo(24 + Math.sin(minAngle) * 18, 24 - Math.cos(minAngle) * 18);
      ctx.stroke();
    });

    const safeLid = level.box(-17, -13.5, 1.0, 1.0, 0.08, 0, darkMetal, { ghost: true });

    level.addInteractable({
      id: 'int_stoppedclock',
      position: new THREE.Vector3(-17, 1.9, -19.6),
      radius: 2.4,
      prompt: () => (clockSet ? 'The hands read 11:47' : 'Move the stopped clock hands'),
      use: () => {
        if (clockSet) return;
        if (!game.state.persistent.managerFound && !game.state.hasNote("The stopped clock opens the floor safe. Set it to 11:47.")) {
          game.toast('The hands move freely, but you do not know where to set them.');
          return;
        }
        clockSet = true;
        stopped.redraw();
        game.audio.lockClick(true);
        game.audio.cutHum(1.4);
        safeLid.visible = false;
        game.toast('Something heavy unlatches under the floor.');
      },
      onReset: () => {
        clockSet = false;
        stopped.redraw();
        safeLid.visible = true;
      },
    });

    const safe = level.addInteractable({
      id: 'int_safe',
      position: new THREE.Vector3(-17, 0.3, -13.5),
      radius: 2.0,
      prompt: () => (clockSet ? 'Open the floor safe' : 'A seam in the floorboards'),
      use: () => {
        if (!clockSet) {
          game.toast('Sealed. Something has to release it.');
          return;
        }
        game.audio.paper();
        game.state.run.hasWalkie = true;
        game.showDocument(DOCUMENTS.waltersletter.title, DOCUMENTS.waltersletter.lines());
        game.note('Walter', 'Walter has been resetting the loop to keep people away from the thing on camera four.');
        game.note('Endings', 'Hear every passenger\'s story and a slip with your own name appears in the box.');
        game.toast('You take a walkie-talkie.');
      },
    });

    level.addLight(-17, ROOMS.manager.h - 0.3, -15, { intensity: 0.5, distance: 10, room: 'manager', flicker: 0.5 });
  })();

  // ---- Lost & Found ------------------------------------------------------

  (function lostfound() {
    // Shelving. Three double-sided racks with a thin spine, rather than the
    // solid 0.6-deep slabs this used to be -- those were deep enough that
    // anything placed at the centre line of a rack ended up buried inside it,
    // which is exactly where the belongings were sitting.
    const SHELF_Z = [1.4, 5.0, 8.6];
    const SHELF_Y = [0.6, 1.3, 1.95];
    const SHELF_D = 0.86;   // full depth, so 0.43 of usable ledge per side
    for (const sz of SHELF_Z) {
      // Spine down the middle, so the two faces cannot see through each other.
      level.box(-17, sz, 11.0, 0.08, 2.2, 0, darkMetal, { ghost: true });
      // Uprights.
      for (const ux of [-22.5, -19.8, -17, -14.2, -11.5]) {
        level.box(ux, sz, 0.09, SHELF_D, 2.2, 0, darkMetal, { ghost: true });
      }
      for (const sy of SHELF_Y) {
        level.box(-17, sz, 11.2, SHELF_D, 0.06, sy, metal, { ghost: true });
      }
      // One collider for the whole rack: the parts are ghosts so that the
      // player cannot get wedged between an upright and a shelf lip.
      level.addCollider(-22.6, sz - SHELF_D / 2, -11.4, sz + SHELF_D / 2, 2.2);
    }

    // A wall of coin lockers down the west end, so the room reads as a place
    // that stores things rather than a room with three racks in it.
    const coinLockers = makeLockers(4, 5, {
      body: paint(0x3e4c45),
      door: paint(0x4a5a52),
      metal,
    });
    coinLockers.position.set(-22.7, 0, 3.2);
    coinLockers.rotation.y = Math.PI / 2;
    level.group.add(coinLockers);
    level.addCollider(-22.95, 2.44, -22.45, 3.96, 2.2);

    // One belonging per passenger, laid out across the shelf surfaces.
    //
    // This used to be five hand-placed entries, which silently capped the game
    // at five returnable stories no matter how many passengers content.js
    // defined -- and the good ending requires hearing all of them. Deriving the
    // layout means adding a passenger is a one-file change.
    //
    // Only the faces that front onto an aisle get stock. The middle rack is
    // reachable from both sides; the outer two have a wall behind them, so
    // shelving their blind face would just hide items in a gap.
    const SHELF_SIDES = [[1], [-1, 1], [-1]];
    const surfaces = [];
    SHELF_Z.forEach((sz, rack) => {
      for (const side of SHELF_SIDES[rack]) {
        for (const sy of SHELF_Y) {
          surfaces.push({ z: sz + side * 0.2, y: sy + 0.06, side });
        }
      }
    });

    const SPAN = 9.6;        // usable length of a shelf, inset from the ends
    const UPRIGHTS = [-22.5, -19.8, -17, -14.2, -11.5];

    // Surfaces are dealt round-robin so the racks fill evenly -- you are never
    // looking at a packed shelf next to an empty one. Position along the shelf
    // comes from the golden ratio rather than from a column index: stepping by
    // an irrational fraction never repeats, so fourteen items land spread along
    // the full ten metres instead of stacking into two tidy columns, which is
    // what a grid layout gave and what made the racks look unstocked.
    const slots = PASSENGERS.map((p, i) => {
      const surface = surfaces[i % surfaces.length];
      const t = (i * 0.6180339887 + 0.5) % 1;
      let x = -17 - SPAN / 2 + SPAN * t;
      // An upright is only 9cm wide but an item is 20-30, so anything landing
      // on a post has to step aside or it grows through it.
      for (const ux of UPRIGHTS) {
        if (Math.abs(x - ux) < 0.24) x = ux + (x < ux ? -0.24 : 0.24);
      }
      // Deterministic nudge off the shelf line: shelved by hand, not stacked.
      const jitter = ((i * 2654435761) % 1000) / 1000 - 0.5;
      return {
        p,
        x,
        z: surface.z + jitter * 0.1,
        y: surface.y,
        // Turned to roughly face the aisle they are reachable from, plus a few
        // degrees of slop so the row does not look squared up.
        yaw: (surface.side > 0 ? 0 : Math.PI) + jitter * 0.8,
      };
    });

    // Shared across all fourteen: the shapes differ, the materials do not.
    const itemMats = {
      item: mat({ color: 0x6a5a44, roughness: 0.78 }),
      paper: mat({ color: 0xbcb49c, roughness: 0.9 }),
      metal: mat({ color: 0x8a8f8c, roughness: 0.45, metalness: 0.6 }),
      dark: mat({ color: 0x2c3034, roughness: 0.6 }),
    };

    for (const slot of slots) {
      // Modelled to its description, so you can tell a hatbox from a duffel
      // from the aisle instead of having to read every prompt in the room.
      const mesh = makeBelonging(slot.p.item, itemMats);
      mesh.position.set(slot.x, slot.y, slot.z);
      mesh.rotation.y = slot.yaw;
      level.group.add(mesh);

      const it = level.addInteractable({
        id: 'int_belonging_' + slot.p.itemId,
        position: new THREE.Vector3(slot.x, slot.y + 0.08, slot.z),
        // Tighter than most interactables. There are fourteen of these within
        // a few metres of each other, and the prompt is picked mostly on aim,
        // so a generous radius just means the room offers you something you
        // are not looking at.
        radius: 1.5,
        prompt: () => {
          if (game.state.persistent.heardStories.includes(slot.p.id)) {
            return `${slot.p.item} (returned)`;
          }
          return `Take: ${slot.p.item}`;
        },
        use: () => {
          if (game.state.persistent.heardStories.includes(slot.p.id)) {
            game.toast('You have already heard that one.');
            return;
          }
          if (game.carrying) {
            game.toast(`Your hands are full: ${game.carrying.item}`);
            return;
          }
          game.carrying = { id: slot.p.itemId, item: slot.p.item, owner: slot.p.id };
          mesh.visible = false;
          it.enabled = false;
          game.audio.paper();
          game.toast(`Carrying: ${slot.p.item}`);
          game.note('Lost & Found', `${slot.p.item} belongs to ${slot.p.name}.`);
        },
        onReset: () => {
          mesh.visible = !game.state.persistent.heardStories.includes(slot.p.id);
          it.enabled = true;
        },
      });
    }

    // Transfer slip box: which slip you punch decides the ending.
    level.box(-13.0, 9.0, 1.2, 0.8, 1.0, 0, woodMat);
    level.addInteractable({
      id: 'int_transferslips',
      position: new THREE.Vector3(-13.0, 1.0, 8.6),
      radius: 2.2,
      prompt: () => 'Search the transfer slips',
      use: () => {
        const ownSlip = game.state.heardAllStories(PASSENGERS.length);
        const options = PASSENGERS.map((p) => ({
          id: p.id,
          label: `${p.name} — ${p.where.room === 'bays' ? 'coast route' : 'coast route'}`,
        }));
        if (ownSlip) options.unshift({ id: 'self', label: 'A slip with YOUR OWN name on it', own: true });
        game.chooseSlip(options);
        game.note('Ticket', 'Part 3 of 3: a transfer slip from Lost & Found, punched by the conductor\'s punch.');
      },
    });

    document('int_postcards', -21.0, 1.35, 8.6, 0, 'postcards', {
      prompt: 'Read the postcards',
      onRead: () => game.note('Passengers', 'Fourteen postcards in Lost & Found. None were ever sent.'),
    });

    // Flashlight.
    const flashMesh = level.box(-14.0, 1.4, 0.26, 0.1, 0.1, 1.42, mat({ color: 0x9a6a22 }), { ghost: true });
    flashMesh.position.set(-14.0, 1.48, 1.4);
    const flashIt = level.addInteractable({
      id: 'int_flashlight',
      position: new THREE.Vector3(-14.0, 1.48, 1.4),
      radius: 2.0,
      prompt: () => 'Take the flashlight',
      use: () => {
        game.state.run.hasFlashlight = true;
        game.player.battery = 1;
        flashMesh.visible = false;
        flashIt.enabled = false;
        game.toast('Flashlight. F to switch on.');
        game.note('Items', 'A flashlight sits on the Lost & Found shelves. The beam carries further than you think.');
      },
      onReset: () => {
        flashMesh.visible = true;
        flashIt.enabled = true;
      },
    });

    coin('coin_lost', -20.0, 0.75, 1.4, 'A wallet on the Lost & Found shelf had a coin in it.');

    level.addLight(-17, ROOMS.lostfound.h - 0.3, 3, { intensity: 0.7, distance: 12, room: 'lostfound' });
    level.addLight(-17, ROOMS.lostfound.h - 0.3, 8, { intensity: 0.55, distance: 11, room: 'lostfound', flicker: 0.4 });
  })();

  // ---- Security / CCTV ---------------------------------------------------

  (function cctv() {
    level.box(17, -3.2, 5.0, 1.0, 0.8, 0, woodMat);

    // Four monitors. Camera 4 is where the other thing shows up.
    refs.monitors = textPanel(17, 1.75, -3.9, 0, 3.4, 1.6, 136, 64, (ctx, w, h) => {
      ctx.fillStyle = '#0a0d0c';
      ctx.fillRect(0, 0, w, h);
      const views = game.cameraViews ?? [];
      for (let i = 0; i < 4; i++) {
        const cx = (i % 2) * 68;
        const cy = Math.floor(i / 2) * 32;
        ctx.fillStyle = '#05120c';
        ctx.fillRect(cx + 2, cy + 2, 64, 28);
        // Scanlines.
        ctx.fillStyle = 'rgba(80,255,160,0.06)';
        for (let y = cy + 2; y < cy + 30; y += 2) ctx.fillRect(cx + 2, y, 64, 1);
        ctx.fillStyle = PALETTE.screenGreen === 0x4dff9b ? '#4dff9b' : '#4dff9b';
        ctx.font = '5px monospace';
        ctx.fillText(`CAM ${i + 1}`, cx + 4, cy + 9);
        const view = views[i];
        if (view) {
          ctx.fillText(view.label.slice(0, 13), cx + 4, cy + 17);
          if (view.attendant) {
            // Draw him, small and far down the room, rather than just naming him.
            silhouette(ctx, cx + 48, cy + 29, 20, { color: 'rgba(3,20,12,0.95)' });
            ctx.fillStyle = '#ff9b4d';
            ctx.fillText('> FIGURE', cx + 4, cy + 25);
          }
          if (view.staring) {
            // Standing at the lens. Fills the cell, and it has eyes.
            silhouette(ctx, cx + 34, cy + 31, 56, {
              color: 'rgba(2,8,6,0.97)',
              eyes: true,
              eyeColor: '#d8fff0',
              tilt: view.staring === 2 ? 0.5 : 0,
            });
          }
          if (view.anomaly) {
            ctx.fillStyle = '#ff4d6b';
            ctx.fillText('> ' + view.anomaly, cx + 4, cy + 25);
          }
        } else {
          ctx.fillText('NO SIGNAL', cx + 4, cy + 17);
        }
      }
    });

    level.addInteractable({
      id: 'int_monitors',
      position: new THREE.Vector3(17, 1.6, -3.9),
      radius: 2.6,
      prompt: () => 'Watch the monitors',
      use: () => game.watchMonitors(),
    });

    // The PA microphone: send him somewhere he is not.
    cyl(15.4, 0.8, -3.4, 0.08, 0.35, darkMetal);
    level.addInteractable({
      id: 'int_pamic',
      position: new THREE.Vector3(15.4, 1.1, -3.4),
      radius: 2.2,
      prompt: () => 'Use the PA microphone',
      use: () => game.usePAMic(),
    });

    // The keyring on its hook.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.028, 5, 9),
      mat({ color: 0xc8b878, emissive: 0x2a2410 })
    );
    ring.position.set(22.6, 1.6, -6.5);
    ring.rotation.y = Math.PI / 2;
    level.group.add(ring);

    const ringIt = level.addInteractable({
      id: 'int_keyring',
      position: new THREE.Vector3(22.5, 1.6, -6.5),
      radius: 2.0,
      prompt: () => (game.attendantHasRing() ? 'The hook is empty' : "Take Walter's keyring"),
      use: () => {
        if (game.attendantHasRing()) {
          game.toast('He is carrying it tonight.');
          game.note('Keyring', 'If Walter is carrying the ring, the hook in Security is empty. Wait for his rounds.');
          return;
        }
        game.state.run.hasKeyring = true;
        ring.visible = false;
        ringIt.enabled = false;
        game.audio.keyJingle();
        game.makeNoise(22.5, -6.5, 0.5, 'the keyring');
        game.toast("Walter's keyring. It will not stop jingling.");
        game.note('Keyring', 'The keyring hangs in Security. It opens the stamp drawer, the lockers, the service door.');
      },
      onReset: () => {
        ring.visible = true;
        ringIt.enabled = true;
      },
    });
    refs.keyringMesh = ring;

    cellPack('int_cells_cctv', 18.8, 0.8, -3.2, 'Spare cells sit on the security desk.');

    document('int_pascript', 15.0, 1.0, -4.2, 0, 'pascript', {
      prompt: 'Read the PA scripts',
      flat: true,
      onRead: () => {
        game.note('PA', 'One PA script has your own name typed into it. The ink is fresh.');
        game.note('Rules', 'A script in Walter\'s hand reads: "Do not answer to your name."');
      },
    });

    level.addLight(17, ROOMS.cctv.h - 0.3, -6, { intensity: 0.45, distance: 9, room: 'cctv', color: 0xa8d8c0, flicker: 0.3 });
  })();

  // ---- Diner Counter -----------------------------------------------------

  (function diner() {
    level.box(17, 3.0, 9.0, 1.0, 1.1, 0, woodMat);
    level.box(17, 3.0, 9.2, 1.1, 0.08, 1.1, metal, { ghost: true });
    for (const sx of [13.5, 15.5, 17.5, 19.5]) {
      cyl(sx, 0, 4.6, 0.22, 0.75, darkMetal, true);
    }

    level.addHideSpot({
      id: 'hide_counter',
      name: 'behind the counter',
      position: new THREE.Vector3(17, 0, 1.9),
      exit: new THREE.Vector3(17, 0, 4.4),
      lookYaw: Math.PI,
      quality: 0.85,
      promptName: 'Hide behind the counter',
    });

    // Vending machines: coins out, but they are loud.
    const vendingDefs = [
      { id: 'vend1', x: 12.1, z: 8.0, color: 0x7a2a22, label: 'COLA' },
      { id: 'vend2', x: 12.1, z: 5.6, color: 0x22407a, label: 'SNACK' },
    ];
    for (const v of vendingDefs) {
      // Modelled as a carcass around a window rather than a painted box, with
      // shelves and product behind real glass. These are the only things in the
      // station lit from inside, so they are the one place the player can stand
      // and see without the flashlight -- which makes them worth looking at.
      const unit = makeVending({
        body: paint(v.color),
        dark: darkMetal,
        // Mostly transparent, so the shelves behind it are the thing you see.
        // The emissive is deliberately low: it is the glow leaking out of the
        // cabinet, not a lamp, and the bloom threshold sits at 0.92.
        glass: mat({ color: 0xbfe4ee, emissive: 0x16323a, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22 }),
        product: mat({ color: 0x8a7a5a, roughness: 0.6 }),
        light: mat({ color: 0xd8e8e0, emissive: 0x3a4a46 }),
      });
      unit.position.set(v.x, 0, v.z);
      // Built facing +z; against the diner's west wall it has to face +x.
      unit.rotation.y = Math.PI / 2;
      level.group.add(unit);
      level.addCollider(v.x - 0.36, v.z - 0.48, v.x + 0.36, v.z + 0.48, 1.85);

      // The lit header card, in the gap the carcass leaves between the top of
      // the glass and the top plate. This is the only part that needs to carry
      // a word, so it is the only part that is still a texture.
      textPanel(v.x + 0.36, 1.725, v.z + 0.06, Math.PI / 2, 0.56, 0.14, 56, 14, (ctx, w, h) => {
        ctx.fillStyle = '#e8f0ec';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1a2422';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(v.label, w / 2, 11);
      });
      let used = false;
      const it = level.addInteractable({
        id: 'int_' + v.id,
        position: new THREE.Vector3(v.x + 0.5, 1.2, v.z),
        radius: 2.2,
        prompt: () => (used ? 'The coin return is empty' : 'Hit the coin return'),
        use: () => {
          if (used) return;
          used = true;
          game.state.run.coins++;
          game.audio.vendingClunk();
          game.makeNoise(v.x, v.z, 0.85, 'a vending machine');
          game.toast(`A 1987 coin rolls out. (${game.state.run.coins})`);
          game.note('Coins', 'Both vending machines in the diner give up a coin. They clunk; he hears it.');
        },
        onReset: () => {
          used = false;
        },
      });
      // Cold machine glow, from inside the carcass rather than hovering in
      // front of it. This light used to sit 25cm off the front face, which was
      // survivable when the front was an unlit texture panel but blows out
      // completely now the glass is real lit geometry -- a fixture intensity of
      // 0.4 is 20 candela, and 20 candela at a quarter of a metre is white.
      // Inside and weak, it backlights the shelves and the product instead.
      level.addLight(v.x - 0.12, 1.0, v.z, {
        intensity: 0.1, distance: 2.4, decay: 1.4,
        color: 0x9fd8ff, room: 'diner', flicker: 0.15, fixtureW: 0.25,
      });
    }

    // Jukebox.
    level.box(22.0, 8.6, 1.1, 0.8, 1.5, 0, mat({ color: 0x5a2a3a }));
    const juke = textPanel(22.0, 1.1, 8.15, 0, 0.9, 0.7, 40, 32, (ctx, w, h) => {
      ctx.fillStyle = '#1a0e14';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8b050';
      ctx.font = '5px monospace';
      ctx.fillText('SELECT', 3, 8);
      const labels = ['A1 BLUE HWY', 'A2 LAST CALL', 'B3 HOLLOW MOON'];
      labels.forEach((l, i) => {
        ctx.fillStyle = game.state?.run.jukeboxPlayed && i === 2 ? '#6bffb0' : '#c8a070';
        ctx.fillText(l, 3, 16 + i * 6);
      });
    });
    level.addInteractable({
      id: 'int_jukebox',
      position: new THREE.Vector3(22.0, 1.1, 8.15),
      radius: 2.2,
      prompt: () => 'Use the jukebox',
      use: () => game.useJukebox(juke.redraw),
    });
    refs.jukeboxPos = new THREE.Vector3(22.0, 1.1, 8.3);

    // Coffee pot and batteries.
    cyl(19.0, 1.1, 2.6, 0.12, 0.28, mat({ color: 0x2a2a2a }));
    level.addInteractable({
      id: 'int_coffeepot',
      position: new THREE.Vector3(19.0, 1.3, 2.6),
      radius: 1.9,
      prompt: () => 'The coffee pot',
      use: () => {
        game.audio.blip({ freq: 300, type: 'sine', dur: 0.2, vol: 0.08 });
        game.showDocument('Coffee Pot', [
          'Still warm. It has been still warm since 1987.',
          'There is one cup poured, on the counter, with a saucer over it to keep the heat in.',
          'Someone meant to come back for it.',
        ]);
      },
    });

    cellPack('int_batteries', 20.2, 1.15, 2.6, 'Spare cells sit on the diner counter.');

    coin('coin_diner', 17.0, 1.15, 6.4, 'A coin was left on the diner counter.');

    level.addLight(17, ROOMS.diner.h - 0.3, 3, { intensity: 0.75, distance: 12, room: 'diner' });
    level.addLight(17, ROOMS.diner.h - 0.3, 8, { intensity: 0.6, distance: 11, room: 'diner', flicker: 0.25 });
  })();

  // ---- Restrooms ---------------------------------------------------------

  (function restroom() {
    const stallMat = mat({ color: 0x3a5048 });
    // Three stalls along the south wall.
    const stallX = [-11.2, -8.6, -6.0];
    for (const [i, sx] of stallX.entries()) {
      level.box(sx - 1.2, 17.6, 0.12, 2.6, 2.2, 0, stallMat);
      level.box(sx, 18.9, 2.4, 0.12, 2.2, 0, stallMat, { ghost: true });
      // Toilet.
      cyl(sx, 0, 18.3, 0.22, 0.42, mat({ color: 0xb0b8ae }), true);
      level.addHideSpot({
        id: 'hide_stall_' + i,
        name: 'a stall',
        position: new THREE.Vector3(sx, 0, 17.4),
        exit: new THREE.Vector3(sx, 0, 15.6),
        lookYaw: Math.PI,
        quality: 1.0,
        promptName: 'Hide in the stall',
      });
    }
    level.box(-4.6, 17.6, 0.12, 2.6, 2.2, 0, stallMat);

    // Sinks and the mirror.
    for (const sx of [-11.5, -9.5, -7.5]) {
      level.box(sx, 10.7, 1.4, 0.6, 0.2, 0.85, mat({ color: 0xa8b0a6 }));
    }
    const mirror = textPanel(-9.5, 1.65, 10.55, 0, 5.2, 1.5, 128, 40, (ctx, w, h) => {
      ctx.fillStyle = '#1d2b28';
      ctx.fillRect(0, 0, w, h);
      // Tarnished glass.
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(${90 + Math.random() * 60 | 0},${110 + Math.random() * 60 | 0},${100 + Math.random() * 50 | 0},0.08)`;
        ctx.fillRect(Math.random() * w | 0, Math.random() * h | 0, 2, 1);
      }
      ctx.fillStyle = 'rgba(200,220,210,0.18)';
      ctx.fillRect(0, 0, w, 3);

      // Something standing in the room behind you. The mirror shows it long
      // before you can turn around, and it is never there when you do.
      if (game.mirrorFigure) {
        const f = game.mirrorFigure;
        silhouette(ctx, w * (f.at ?? 0.68), h - 1, h * (f.scale ?? 0.92), {
          tilt: f.tilt ?? 0,
          eyes: f.eyes ?? false,
          color: `rgba(4,6,9,${f.alpha ?? 0.9})`,
        });
      }

      if (game.mirrorRevealing) {
        ctx.fillStyle = '#9fe8c0';
        ctx.font = '7px monospace';
        ctx.fillText('THE WALL, REVERSED:', 4, 11);
        ctx.fillStyle = '#ff6b6b';
        ctx.font = '6px monospace';
        ctx.fillText('RULE: DEPARTURE BOARD ....... FALSE', 4, 23);
        ctx.fillText('RULE: FLASHLIGHT LIT ........ FALSE', 4, 33);
      }
    });
    refs.mirror = mirror;

    level.addInteractable({
      id: 'int_mirror',
      position: new THREE.Vector3(-9.5, 1.6, 10.6),
      radius: 2.6,
      prompt: () => 'Look in the mirror',
      use: () => game.useMirror(),
    });

    document('int_handwritten', -6.0, 1.5, 18.8, Math.PI, 'handwritten', {
      prompt: 'Read the handwritten sign',
      onRead: () => {
        game.note('Rules', 'A handwritten sign: two of the posted rules are not the station\'s. "One wants you blind. One wants you lit up."');
      },
    });

    coin('coin_restroom', -11.5, 0.95, 10.7, 'Someone left a coin on the restroom sink.');

    level.addLight(-9.5, ROOMS.restroom.h - 0.25, 12.5, { intensity: 0.7, distance: 11, room: 'restroom', flicker: 0.75, color: 0xcfe8d8 });
    level.addLight(-9.5, ROOMS.restroom.h - 0.25, 17.5, { intensity: 0.5, distance: 10, room: 'restroom', flicker: 0.9 });
  })();

  // ---- Baggage Claim -----------------------------------------------------

  (function baggage() {
    // Conveyor loop.
    const beltMat = mat({ color: 0x24282a });
    level.box(11, 18.5, 14.0, 2.2, 0.75, 0, beltMat);
    level.box(11, 18.5, 14.2, 2.4, 0.1, 0.75, mat({ color: 0x15181a }), { ghost: true });
    refs.beltPos = new THREE.Vector3(11, 0.8, 18.5);

    level.addHideSpot({
      id: 'hide_conveyor',
      name: 'behind the conveyor',
      position: new THREE.Vector3(11, 0, 20.4),
      exit: new THREE.Vector3(11, 0, 21.6),
      lookYaw: 0,
      quality: 0.9,
      promptName: 'Hide behind the conveyor',
    });

    level.addInteractable({
      id: 'int_conveyor',
      position: new THREE.Vector3(11, 0.9, 18.5),
      radius: 2.6,
      prompt: () => 'The conveyor belt',
      use: () => {
        game.audio.vendingClunk();
        game.makeNoise(11, 18.5, 0.7, 'the conveyor');
        game.showDocument('Conveyor Belt', [
          'You push the lever. The belt shudders and starts to move.',
          'A single suitcase comes around, goes through the flaps, and comes around again.',
          'It has a tag on it with your name and tonight\'s date.',
        ]);
        game.note('Baggage', 'A suitcase on the belt is tagged with your own name.');
      },
    });

    // Lockers. One holds the conductor's punch behind a letter lock.
    //
    // Built as one welded bank rather than four free-standing boxes: the doors
    // are inset into a frame and each has a louvred vent, which matters because
    // three of these are hide spots and the vent is the player's reason to
    // believe they can see out while the door is shut.
    const lockerX = [3.0, 4.6, 6.2, 7.8];
    // Values matched to the Lost & Found coin lockers. The first pass used a
    // darker blue-grey and the whole bank sank into a black mass against the
    // pale wall -- no use for something the player is meant to spot from across
    // the room and climb into.
    const lockerBank = makeLockers(4, 1, {
      body: paint(0x3e4c45),
      door: paint(0x4a5a52),
      metal,
    }, { cw: 1.6, ch: 2.1, d: 1.0 });
    lockerBank.position.set(5.4, 0, 11.0);
    level.group.add(lockerBank);
    level.addCollider(2.2, 10.5, 8.6, 11.5, 2.1);

    for (const [i, lx] of lockerX.entries()) {
      if (i < 3) {
        level.addHideSpot({
          id: 'hide_locker_' + i,
          name: 'a locker',
          position: new THREE.Vector3(lx, 0, 11.8),
          exit: new THREE.Vector3(lx, 0, 13.0),
          lookYaw: Math.PI,
          quality: 1.0,
          promptName: 'Climb into the locker',
          enclosed: true,
        });
      }
    }

    let punchTaken = false;
    level.addInteractable({
      id: 'int_codelocker',
      position: new THREE.Vector3(7.8, 1.3, 11.7),
      radius: 2.2,
      prompt: () => {
        if (punchTaken) return 'Locker 9 is empty';
        return game.state.knowsCode('locker')
          ? `Enter ${game.state.persistent.knownCodes.locker} on the dials`
          : 'Locker 9: four letter dials';
      },
      use: () => {
        if (punchTaken) return;
        if (!game.state.knowsCode('locker')) {
          game.audio.lockClick(false);
          game.toast('Four letter dials. You do not know the word.');
          game.note('Locker', 'Locker 9 in Baggage Claim has a four-letter dial lock.');
          return;
        }
        if (game.state.persistent.knownCodes.locker !== LOCKER_CODE) {
          game.audio.lockClick(false);
          game.toast('The dials will not turn to that.');
          return;
        }
        punchTaken = true;
        game.state.run.hasPunch = true;
        game.audio.lockClick(true);
        game.toast("The conductor's punch.");
        game.note('Ticket', "The conductor's punch is in Locker 9. The code is spelled by the cancelled routes.");
      },
      onReset: () => {
        punchTaken = false;
      },
    });

    // Carts.
    for (const [cx, cz] of [[16, 12.5], [18.5, 21.0]]) {
      level.box(cx, cz, 1.6, 1.0, 0.7, 0.25, metal);
      for (const wx of [-0.6, 0.6]) {
        for (const wz of [-0.35, 0.35]) cyl(cx + wx, 0, cz + wz, 0.14, 0.25, darkMetal);
      }
    }

    cellPack('int_cells_cart', 16.0, 0.95, 12.5, 'Spare cells sit in a baggage cart.');

    // Service door to the tunnel.
    level.addInteractable({
      id: 'int_tunneldoor',
      position: new THREE.Vector3(20.6, 1.3, 17),
      radius: 2.4,
      prompt: () => {
        if (!game.state.persistent.tunnelFound) return 'A painted-over service door';
        return game.state.run.hasKeyring ? 'Unlock the service door' : 'Service door (locked)';
      },
      use: () => {
        if (!game.state.persistent.tunnelFound) {
          game.toast('Painted over. There is no handle on this side that you can see.');
          return;
        }
        if (!game.state.run.hasKeyring) {
          game.audio.lockClick(false);
          game.toast("Locked. Walter's ring would open it.");
          return;
        }
        if (level.unlockDoor('tunnelDoor')) {
          game.audio.lockClick(true);
          game.audio.cutHum(2.5);
          game.toast('The service door swings in. Cold air.');
          game.note('Station', 'The service door behind Baggage Claim leads to a maintenance tunnel.');
        }
      },
    });

    level.addLight(6, ROOMS.baggage.h - 0.3, 13, { intensity: 0.8, distance: 13, room: 'baggage' });
    level.addLight(14, ROOMS.baggage.h - 0.3, 16, { intensity: 0.7, distance: 13, room: 'baggage' });
    level.addLight(10, ROOMS.baggage.h - 0.3, 21, { intensity: 0.65, distance: 12, room: 'baggage' });
  })();

  // ---- Maintenance Tunnel + Bay 0 ---------------------------------------

  (function tunnelAndBay0() {
    // Pipes overhead.
    for (const pz of [15.4, 16.4, 18.6]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8, 6), metal);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(25, 2.1, pz);
      level.group.add(pipe);
    }
    level.addLight(25, 2.2, 17, { intensity: 0.22, distance: 6, room: 'tunnel', flicker: 0.95, color: 0xffb070, fixtureW: 0.6 });

    cellPack('int_cells_tunnel', 27.0, 0.05, 15.2, 'Spare cells lie on the tunnel floor.');

    // Bay 0: the bus that is not on any map.
    const busMat = mat({ color: 0x2a3038 });
    level.box(35, 2.0, 2.6, 11.0, 2.9, 0.35, busMat);
    level.box(35, 2.0, 2.4, 11.2, 0.5, 2.3, mat({ color: 0x10141a }), { ghost: true });
    for (const wz of [-2.6, 1.0, 5.4]) {
      for (const wx of [-1.25, 1.25]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8), mat({ color: 0x14161a }));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(35 + wx, 0.42, 2.0 + wz);
        level.group.add(wheel);
      }
    }
    const dest = textPanel(35, 2.9, -3.6, Math.PI, 2.0, 0.4, 64, 14, (ctx, w, h) => {
      ctx.fillStyle = '#0a0c0a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff7b4d';
      ctx.font = '8px monospace';
      // A destination in a script you cannot read.
      ctx.fillText('\u23a1\u2235\u29d6\u2234\u2a1d  \u22c8\u2235\u29d7', 4, 10);
    });

    level.addInteractable({
      id: 'int_bay0bus',
      position: new THREE.Vector3(35, 1.5, -2.0),
      radius: 3.4,
      prompt: () => 'Board the bus with no number',
      use: () => game.triggerEnding('bay0'),
    });

    level.addLight(35, 4.4, 8, { intensity: 0.2, distance: 14, room: 'bay0', color: 0xff8a5a, flicker: 0.5 });
    level.addLight(35, 4.4, -4, { intensity: 0.14, distance: 12, room: 'bay0', color: 0xff6b4a, flicker: 0.7 });
  })();

  // ---- Gate corridor + Bus Bays -----------------------------------------

  (function bays() {
    level.addLight(0, ROOMS.gate.h - 0.3, -13, { intensity: 0.65, distance: 11, room: 'gate' });
    level.addLight(0, ROOMS.gate.h - 0.3, -19, { intensity: 0.5, distance: 11, room: 'gate', flicker: 0.5 });

    // Bay numbers 1..9 painted across the platform, 9 at the west end.
    for (let i = 0; i < 9; i++) {
      const bay = 9 - i;
      const x = -22 + i * 5.5;
      const num = textPanel(x, 0.02, -24.0, 0, 2.2, 2.2, 32, 32, (ctx, w, h) => {
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = bay === 9 ? '#d8c060' : '#7a8078';
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(bay), 16, 24);
      });
      num.mesh.rotation.x = -Math.PI / 2;
      num.mesh.rotation.z = 0;
      num.mesh.position.set(x, 0.02, -24.0);
      num.mesh.material.transparent = true;

      // Platform kerb.
      level.box(x, -25.4, 4.6, 0.4, 0.22, 0, mat({ color: 0x6a6a60 }), { ghost: true });
    }

    // The 3:33 bus sits at Bay 9.
    const busMat = mat({ color: 0x3c4a52 });
    const busGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.9, 11.0), busMat);
    body.position.set(0, 1.8, 0);
    busGroup.add(body);
    const windows = new THREE.Mesh(
      new THREE.BoxGeometry(2.75, 0.9, 9.0),
      mat({ color: 0x0e1418 })
    );
    windows.position.set(0, 2.5, 0);
    busGroup.add(windows);
    for (const wz of [-3.8, 0.6, 4.0]) {
      for (const wx of [-1.3, 1.3]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.32, 8), mat({ color: 0x14161a }));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.46, wz);
        busGroup.add(wheel);
      }
    }
    busGroup.position.set(-22, 0, -31);
    level.group.add(busGroup);
    level.addCollider(-23.4, -36.6, -20.6, -25.4, 3.0);
    refs.bus = busGroup;
    refs.busPos = new THREE.Vector3(-22, 1.2, -27.5);

    // Platform bench at Bay 9, facing the bus. The whole platform was bare
    // concrete and painted numbers, which gave the player nothing to read the
    // space against and nowhere to get out of sight on the one stretch of the
    // station the Attendant walks to at 3:00.
    const platformBench = makeBench(3.0, { wood: seatB, metal: darkMetal });
    platformBench.position.set(-18.0, 0, -22.9);
    platformBench.rotation.y = Math.PI;   // back to the station, seat to the bus
    level.group.add(platformBench);
    level.addCollider(-19.5, -23.25, -16.5, -22.55, 0.56);

    level.addHideSpot({
      id: 'hide_bench_bay9',
      name: 'under the platform bench',
      position: new THREE.Vector3(-18.0, 0, -22.9),
      exit: new THREE.Vector3(-18.0, 0, -24.3),
      lookYaw: Math.PI,
      quality: 0.7,
      promptName: 'Hide under bench',
    });

    // The parts crate from work order 4410, with the packing tape never cut.
    // Straddling the end frame rather than tucked fully underneath: at 0.3m
    // tall and 0.33m behind the seat edge, a crate properly under the bench is
    // occluded by the seat from any standing eye height, and a detail that
    // confirms the document is worthless if you can only see it lying down.
    level.box(-19.55, -22.9, 0.5, 0.42, 0.3, 0, woodMat);
    level.box(-19.55, -22.9, 0.52, 0.06, 0.02, 0.3, paperMat, { ghost: true });

    // Clipboard on the seat, where a man would put it down to look at the lamp.
    level.box(-17.0, -22.9, 0.26, 0.36, 0.015, 0.465, darkMetal, { ghost: true });
    document('int_workorder', -17.0, 0.485, -22.9, Math.PI / 2, 'workorder', {
      prompt: 'Read the work order on the bench',
      flat: true,
      w: 0.22,
      h: 0.32,
      radius: 1.8,
      onRead: () => {
        game.note('Bay 9', 'Bay 9 is three degrees colder than every other bay with the doors shut.');
        game.note('Bay 9', 'The Bay 9 platform lamp reads live with the breaker off.');
        if (game.state.persistent.loop >= 2) {
          game.note('Bay 9', 'Someone wrote NOT A FAULT across Krenshaw\'s work order. Bay 9 is meant to be cold.');
        }
      },
    });

    const busDest = textPanel(-22, 2.9, -25.3, Math.PI, 2.2, 0.45, 64, 14, (ctx, w, h) => {
      ctx.fillStyle = '#0a0c0a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8d070';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('THE COAST  3:33', 32, 10);
    });

    level.addInteractable({
      id: 'int_bus',
      position: new THREE.Vector3(-22, 1.4, -26.0),
      radius: 3.6,
      prompt: () => game.busPrompt(),
      use: () => game.tryBoardBus(),
    });

    // Fog-lit canopy lamps, deliberately dim.
    level.addLight(-22, 4.4, -29, { intensity: 0.5, distance: 16, room: 'bays', color: 0xffd9a0 });
    level.addLight(-8, 4.4, -29, { intensity: 0.35, distance: 15, room: 'bays', color: 0xffd9a0, flicker: 0.3 });
    level.addLight(8, 4.4, -29, { intensity: 0.3, distance: 15, room: 'bays', color: 0xffd9a0 });
    level.addLight(20, 4.4, -29, { intensity: 0.22, distance: 14, room: 'bays', color: 0xffd9a0, flicker: 0.6 });
  })();

  return refs;
}
