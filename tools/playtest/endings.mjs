// Plays every way a night can end, through the game's own interactables:
// the four endings, being caught, and missing the bus.
import { open, close, check } from './lib.mjs';

const s = await open();
const { page } = s;
const ev = (fn, arg) => page.evaluate(fn, arg);

async function continueEnding(id) {
  await page.waitForFunction(() => window.__game.hud.endingOpen, null, { timeout: 60000 });
  const title = await ev(() => document.querySelector('#ending h1').textContent);
  await ev(() => document.querySelector('#endbtn').click());
  await page.waitForTimeout(1200);
  await ev(() => { const g = window.__game; if (g.hud.pauseOpen) g.resume(); H.safe(); });
  const st = await ev(() => H.st());
  check(st.endings.split(',').includes(id), `${id} ending (${title}), then wake on loop ${st.loop}`);
}

// A full ticket the long way round, for whichever slip `slip` picks.
async function ticket(slip = 0) {
  await ev(() => ['coin_hall', 'coin_ticket', 'coin_lost', 'coin_diner'].forEach(H.use));
  await ev(() => H.use('int_ticketmachine'));
  await ev(() => H.use('int_keyring'));
  await ev(() => H.use('int_stampdrawer'));
  await ev(() => { if (!window.__game.state.knowsCode('locker')) { H.use('int_codelocker'); window.__game.hud.dialWord = 'GRAY'.split(''); window.__game.hud.tryDials(); } else H.use('int_codelocker'); });
  await ev((slip) => { H.use('int_transferslips'); H.pick(slip); }, slip);
  const st = await ev(() => H.st());
  check(st.ticket === 'STUB+STAMP+TRANSFER', `ticket assembled (${st.ticket})`);
}

// Night 1: the coast.
await ticket(0);
check((await ev(() => H.at('03:26'))) === '3:26 AM', 'clock to 3:26');
await ev(() => H.use('int_bus'));
await continueEnding('coast');

// Night 2: caught.
await ev(() => { const g = window.__game; g.attendant.grace = 0; g.attendant.position.set(g.player.position.x + 0.5, 0, g.player.position.z); });
await page.waitForFunction(() => window.__game.hud.pauseOpen, null, { timeout: 60000 }).catch(() => {});
let st = await ev(() => H.st());
check(st.loop === 3, `caught: woke on loop ${st.loop}`);
await ev(() => { const g = window.__game; if (g.hud.pauseOpen) g.resume(); H.safe(); });

// Night 3: missed the bus.
await ev(() => { H.at('03:32'); window.__game.clock.time = 24 * 60 + 3 * 60 + 33 - 0.01; });
await page.waitForFunction(() => window.__game.hud.pauseOpen, null, { timeout: 60000 }).catch(() => {});
st = await ev(() => H.st());
check(st.loop === 4, `missed the 3:33: woke on loop ${st.loop}`);
await ev(() => { const g = window.__game; if (g.hud.pauseOpen) g.resume(); H.safe(); });

// Night 4: Bay 0, by Dale's door.
await ev(() => { H.use('int_belonging_thermos'); H.use('int_echo_dale'); H.closeDoc(); });
await ev(() => { H.use('int_keyring'); H.use('int_tunneldoor'); H.use('int_bay0bus'); });
await continueEnding('bay0');

// Night 5: the night shift, by Walter's safe.
await ev(() => { H.use('int_belonging_soldier'); H.use('int_echo_tobias'); H.closeDoc(); });
await ticket(2);
await ev(() => { H.use('int_managerdoor'); H.use('int_stoppedclock'); H.use('int_safe'); });
await page.waitForTimeout(1500);
await ev(() => window.__game.player.endInspecting());
check(await ev(() => window.__game.state.run.hasWalkie), 'walkie from the safe');
await ev(() => { H.at('03:26'); H.use('int_bus'); H.pick(1); });
await continueEnding('nightshift');

// Night 6: home, having heard everyone.
const heard = await ev(() => {
  for (const e of window.__game.echoes.list) {
    H.use('int_belonging_' + e.def.itemId);
    H.use('int_echo_' + e.def.id);
    H.closeDoc();
  }
  return window.__game.state.persistent.heardStories.length;
});
check(heard === 14, `all fourteen heard (${heard})`);
await ticket(0);
check(await ev(() => window.__game.state.run.chosenSlip === 'self'), 'own slip chosen');
await ev(() => { H.at('03:26'); H.use('int_bus'); });
await continueEnding('home');

await close(s, 'endings');
