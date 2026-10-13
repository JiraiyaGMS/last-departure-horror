import * as THREE from 'three';
import { makeFigure, idleSway } from './figures.js';
import { PASSENGERS } from './content.js';

// The passengers from the 1987 bus. Mostly they just sit there. Occasionally
// one asks you what time it is, and the answer matters.

export class Echoes {
  constructor(level, game) {
    this.level = level;
    this.game = game;
    this.list = [];

    // Muted 1980s outerwear, so the hall reads as a crowd of different people
    // who all missed the same bus rather than one ghost copied fourteen times.
    const COATS = [0x3a4a56, 0x4a3f36, 0x2f3d33, 0x55463c, 0x3c3c48, 0x4b4f52, 0x5a4a3a];
    PASSENGERS.forEach((p, i) => {
      const heard = game.state.persistent.heardStories.includes(p.id);
      const figure = makeFigure({
        coat: COATS[i % COATS.length],
        skin: 0x55626a,
        opacity: 0.42,
        height: 1.66 + ((i * 37) % 21) / 100,
        emissive: 0x14222a,
      });
      figure.position.set(p.where.x, 0, p.where.z);
      figure.rotation.y = p.where.yaw;
      level.group.add(figure);

      const echo = {
        def: p,
        figure,
        mutterTimer: 2 + Math.random() * 8,
        askTimer: 14 + Math.random() * 30,
        heard,
        position: new THREE.Vector3(p.where.x, 0, p.where.z),
      };
      this.list.push(echo);

      level.addInteractable({
        id: 'int_echo_' + p.id,
        position: echo.position.clone().setY(1.3),
        radius: 2.6,
        prompt: () => {
          if (game.state.persistent.heardStories.includes(p.id)) return `${p.name}`;
          if (game.carrying && game.carrying.owner === p.id) return `Return the ${p.item.toLowerCase()}`;
          return `${p.name} (missing something)`;
        },
        use: () => {
          if (game.state.persistent.heardStories.includes(p.id)) {
            game.showDocument(p.name, [
              ...p.story,
              '',
              'They are already fading. They have been heard.',
            ]);
            return;
          }
          if (game.carrying && game.carrying.owner === p.id) {
            game.returnBelonging(p, echo);
            return;
          }
          if (game.carrying) {
            game.toast(`They do not want the ${game.carrying.item.toLowerCase()}.`);
            return;
          }
          game.subtitle(`${p.name}: "${p.mutter[Math.floor(Math.random() * p.mutter.length)]}"`);
          game.note('Passengers', `${p.name} is waiting for ${p.item.toLowerCase()}.`);
        },
      });
    });
  }

  reset() {
    for (const echo of this.list) {
      echo.heard = this.game.state.persistent.heardStories.includes(echo.def.id);
      echo.figure.visible = true;
      echo.mutterTimer = 4 + Math.random() * 10;
      echo.askTimer = 14 + Math.random() * 30;
    }
  }

  nearestWithin(pos, radius) {
    for (const echo of this.list) {
      if (echo.position.distanceTo(pos) < radius) return echo;
    }
    return null;
  }

  update(dt, player, t) {
    const presence = this.game.presence;
    // They get less careful about seeming like people the longer you keep
    // coming back.
    const wrongness = Math.min(1, 0.25 + this.game.state.persistent.loop * 0.15);

    for (const echo of this.list) {
      idleSway(echo.figure, t * 0.4);

      const dist = echo.position.distanceTo(player.position);
      const watched = presence
        ? presence.canSee(player, echo.position.x, echo.position.z, 0.5, 24)
        : false;

      // Every one of them is facing you. None of them turns while you watch.
      // (Figures face -Z, so the yaw that points one at the player is
      // atan2 of the offset *toward* the player.)
      if (!watched) {
        const dx = player.position.x - echo.position.x;
        const dz = player.position.z - echo.position.z;
        echo.figure.rotation.y = Math.atan2(-dx, -dz);
      }

      // Watched, close, and late in the night: the head keeps going past where
      // a neck stops, and they forget to be translucent for a frame.
      if (watched && dist < 14) {
        echo.twitchIn = (echo.twitchIn ?? 3) - dt;
        if (echo.twitchIn <= 0) {
          echo.twitchIn = 2.5 + Math.random() * 5 - wrongness * 1.5;
          echo.holdWrong = 0.1 + Math.random() * 0.25;
          echo.wrongTilt = (Math.random() - 0.5) * 2.2 * wrongness;
        }
      }
      const rig = echo.figure.userData.rig;
      if (echo.holdWrong > 0) {
        echo.holdWrong -= dt;
        if (rig) rig.head.rotation.z = echo.wrongTilt;
      } else if (rig) {
        rig.head.rotation.z += (0 - rig.head.rotation.z) * Math.min(1, dt * 4);
      }

      // Heard passengers fade out but do not vanish entirely.
      let targetOpacity = echo.heard ? 0.16 : 0.42;
      // A solid frame now and then. Solid is worse: a ghost you can explain.
      if (echo.holdWrong > 0 && Math.random() < 0.35) targetOpacity = 0.95;
      for (const m of echo.figure.userData.materials ?? []) {
        if (m.transparent) m.opacity += (targetOpacity - m.opacity) * Math.min(1, dt * 6);
      }

      if (dist > 7) continue;

      echo.mutterTimer -= dt;
      if (echo.mutterTimer <= 0) {
        echo.mutterTimer = 12 + Math.random() * 18;
        const line = echo.def.mutter[Math.floor(Math.random() * echo.def.mutter.length)];
        this.game.subtitle(`${echo.def.name}: "${line}"`, 4);
      }

      // The time question. Answer 11:47 or get reported.
      if (!echo.heard && dist < 4.5) {
        echo.askTimer -= dt;
        if (echo.askTimer <= 0 && !this.game.timeChallenge) {
          echo.askTimer = 45 + Math.random() * 40;
          this.game.askTheTime(echo);
        }
      }
    }
  }
}
