// All the writing lives here: the fourteen passengers (five of whom you can
// actually reach in this build), the paper you find, and what the PA says.
//
// The English is the key to every other language (see i18n.js): t() says it
// in the game's language as the game starts. A passenger's name and item, the
// board's timetable and everything that goes in the notebook stay in English
// here, because the game also uses them to name things and the notebook is
// saved in English; they are translated where they are shown.

import { t, msg } from './i18n.js';

export const LOCKER_CODE = 'GRAY';

// The board cycles through these. The cancelled ones spell the locker code.
export const BOARD_ROUTES = [
  { dest: 'GLOVERSVILLE', bay: 2, status: 'CANCELLED' },
  { dest: 'ASHTON FORK', bay: 7, status: 'DELAYED' },
  { dest: 'REDHILL', bay: 4, status: 'CANCELLED' },
  { dest: 'PINE JUNCTION', bay: 1, status: 'DEPARTED' },
  { dest: 'ASHTON FORK', bay: 5, status: 'CANCELLED' },
  { dest: 'WEST MERROW', bay: 3, status: 'DELAYED' },
  { dest: 'YARROW BEND', bay: 6, status: 'CANCELLED' },
  { dest: 'THE COAST', bay: 9, status: '3:33 AM' },
];

export const PASSENGERS = [
  {
    id: 'marguerite',
    name: msg('Marguerite Vance'),
    item: msg('A hatbox, crushed on one side'),
    itemId: 'hatbox',
    // Sitting on the back row of benches, facing the south wall.
    where: { room: 'hall', x: -5.4, z: 5.42, yaw: Math.PI, seat: 0.465 },
    mutter: [
      t('I only sat down for a minute.'),
      t('They said the coast is warmer.'),
      t('Have you heard the one about the hollow moon?'),
    ],
    story: [
      t('"I was going to sing. Properly, I mean, on a stage with a curtain."'),
      t('"Walter used to put my song on the jukebox when the hall was empty."'),
      t('"Hollow Moon. Third button, second row. He always knew."'),
    ],
    reward: { note: [msg('Jukebox'), msg('Marguerite\'s song is "Hollow Moon" — third button, second row.')], code: ['jukebox', 'B3'] },
  },
  {
    id: 'dale',
    name: msg('Dale Krenshaw'),
    item: msg('A dented steel thermos'),
    itemId: 'thermos',
    where: { room: 'bays', x: 6, z: -29, yaw: Math.PI },
    mutter: [
      t('Bus is late. Bus is always late.'),
      t('I keep the belts running. Somebody has to.'),
      t('Don\'t go in the back if you don\'t have the keys.'),
    ],
    story: [
      t('"Thirty-one years on the belts. I knew every inch of the back of this place."'),
      t('"There\'s a service door behind Baggage, east wall. Walter\'s ring opens it."'),
      t('"It goes somewhere that isn\'t on the map. I never walked all the way down."'),
    ],
    reward: { note: [msg('Station'), msg('A locked service door on the east wall of Baggage Claim. The keyring opens it.')], flag: 'tunnelFound' },
  },
  {
    id: 'imelda',
    name: msg('Sister Imelda Ruiz'),
    item: msg('A rosary, two beads missing'),
    itemId: 'rosary',
    where: { room: 'restroom', x: -4, z: 13, yaw: -1.2 },
    mutter: [
      t('I read the signs. I read them very carefully.'),
      t('Not all of it was written by the same hand.'),
      t('After two, look in the glass.'),
    ],
    story: [
      t('"Somebody else has been adding rules. The letters lean the wrong way."'),
      t('"The mirrors in here do not lie. The walls do."'),
      t('"After two in the morning, read the signs in the glass. You will see which ones are not real."'),
    ],
    reward: { note: [msg('Rules'), msg('After 2:00 AM the restroom mirror shows which posted rules are false.')] },
  },
  {
    id: 'tobias',
    name: msg('Tobias Penn'),
    item: msg('A lead soldier, paint worn off'),
    itemId: 'soldier',
    where: { room: 'ticket', x: -14.6, z: -7, yaw: 1.6 },
    mutter: [
      t('My uncle works here. He has a hat and everything.'),
      t('He said he\'d be right behind me.'),
      t('The clock upstairs is stuck.'),
    ],
    story: [
      t('"Uncle Walter stamped my ticket himself. He said he\'d get the next one."'),
      t('"He keeps a safe under the floor in his office. The stopped clock opens it."'),
      t('"Set it to when the bus left. He checks it every night. Every single night."'),
    ],
    reward: { note: [msg('Manager\'s Office'), msg('The stopped clock opens the floor safe. Set it to 11:47.')], flag: 'managerFound' },
  },
  {
    id: 'nina',
    name: msg('Nina Abbot'),
    item: msg('A camera with film still in it'),
    itemId: 'camera',
    where: { room: 'diner', x: 15, z: 7.4, yaw: -2.4 },
    mutter: [
      t('I photograph buildings. This one photographs back.'),
      t('There\'s a bay they painted over.'),
      t('Camera four sees more than four things.'),
    ],
    story: [
      t('"I counted the bays from outside. There are ten doors and nine numbers."'),
      t('"The tenth is at the end of the service tunnel. They stopped numbering it."'),
      t('"Whatever walks the cameras is going there. It has been getting closer all night."'),
    ],
    reward: { note: [msg('Bay 0'), msg('There is a tenth bay at the end of the service tunnel. It has no number.')] },
  },
  {
    id: 'roy',
    name: msg('Roy Teague'),
    item: msg('A trucker\'s logbook, last page blank'),
    itemId: 'logbook',
    where: { room: 'gate', x: -1, z: -17, yaw: 0 },
    mutter: [
      t('Twenty-two hours up. I only shut my eyes at the light.'),
      t('You can\'t deadhead a bus. A bus has to be full.'),
      t('It\'s longer going back than it was coming out.'),
    ],
    story: [
      t('"Nineteen years hauling freight and this was the first time I rode instead of drove. Her birthday."'),
      t('"Count your steps down this corridor. Forty going out. If it\'s forty-four coming back, stop."'),
      t('"That\'s the night taking a bite out of the middle. Turn around and start the count again."'),
    ],
    reward: { note: [msg('Gate Corridor'), msg('Count your steps in the gate corridor. If the way back runs longer than the way out, turn around.')] },
  },
  {
    id: 'lorraine',
    name: msg('Lorraine Fisk'),
    item: msg('A nurse\'s fob watch, pinned upside down'),
    itemId: 'fobwatch',
    where: { room: 'cctv', x: 19.4, z: -5.4, yaw: -0.8 },
    mutter: [
      t('Double shift. I can sleep sitting up with my eyes open.'),
      t('Thirty-eight. Thirty-nine. Forty.'),
      t('Camera four is panning again. Nobody told it to.'),
    ],
    story: [
      t('"Sixteen hours at Mercy, then the coast to meet my sister\'s baby. I had a little bear in my bag for her."'),
      t('"Nine cameras, nine monitors. When one goes to snow, the thing has stepped out of that picture."'),
      t('"Forty seconds and it\'s in the next room. I count for it now. Out loud. It likes being counted for."'),
    ],
    reward: { note: [msg('Camera Four'), msg('A monitor turning to snow means the thing has left that picture. You have about forty seconds.')] },
  },
  {
    id: 'curtis',
    name: msg('Curtis Mabry'),
    item: msg('A duffel bag with a boy\'s name inked inside'),
    itemId: 'duffel',
    where: { room: 'lostfound', x: -20, z: 3, yaw: 1.9 },
    mutter: [
      t('I\'m sixteen. I\'ll be seventeen in the spring.'),
      t('He let me on without a fare. He just looked at me a while.'),
      t('Don\'t take anything off the bottom row.'),
    ],
    story: [
      t('"Eleven dollars, one bag, and nobody at home who was going to miss the quiet I left behind."'),
      t('"The attendant never asked me for a fare. He wrote me in the book anyway, so I\'d count as somebody."'),
      t('"Bottom shelf in here is the unclaimed. Some of those tags have years on them that haven\'t come yet."'),
    ],
    reward: { note: [msg('Lost & Found'), msg('The bottom shelf is unclaimed property. Some of the tags are dated years that have not happened.')] },
  },
  {
    id: 'vernon',
    name: msg('Vernon Hatch'),
    item: msg('A salesman\'s case of buttons'),
    itemId: 'samplecase',
    where: { room: 'hall', x: 8, z: -6, yaw: 2.2 },
    mutter: [
      t('Buttons. Everybody needs buttons. Recession-proof line.'),
      t('I had a nine o\'clock in Yarrow Bend. I had.'),
      t('Gloversville. Redhill. Ashton. Yarrow. Gloversville. Redhill —'),
    ],
    story: [
      t('"Twenty-six towns a month. Not one of them would notice if I stopped coming, and here we are."'),
      t('"I know that board by heart. Four cancelled tonight: Gloversville, Redhill, Ashton Fork, Yarrow Bend."'),
      t('"Take the first letter off each, in the order the board gives them. It opens a locker that isn\'t mine."'),
    ],
    reward: { note: [msg('Departure Board'), msg('The cancelled destinations, read in board order, spell a four-letter locker code.')] },
  },
  {
    id: 'eunice',
    name: msg('Eunice Pike'),
    item: msg('A paper bag of boiled sweets'),
    itemId: 'sweets',
    where: { room: 'baggage', x: 4.6, z: 13, yaw: 2.7 },
    mutter: [
      t('Harold has the tickets. Harold always has the tickets.'),
      t('He only went to see about the cases.'),
      t('Forty-one years and I have never had to wait this long for him.'),
    ],
    story: [
      t('"The coast, for our anniversary. Harold went to see about the cases and he did not come back for me."'),
      t('"The carousel runs on the hour. Ours never comes round again — it goes past the rubber flap and out."'),
      t('"My husband followed our luggage through there. If you find him, tell him I stayed where he left me."'),
    ],
    reward: { note: [msg('Baggage Claim'), msg('The carousel runs on the hour. Anything that passes the rubber flap does not come back around.')] },
  },
  {
    id: 'harold',
    name: msg('Harold Pike'),
    item: msg('A pair of reading glasses, one lens cracked'),
    itemId: 'glasses',
    where: { room: 'tunnel', x: 25, z: 17, yaw: -1.5 },
    mutter: [
      t('The cases came through here. I could hear the wheels on the concrete.'),
      t('There\'s a light at the far end. It idles.'),
      t('Eunice will be worried. Eunice does worry.'),
    ],
    story: [
      t('"I came in after the cases and the door shut polite behind me, the way it does when a man holds it."'),
      t('"There\'s an engine running at the far end. It hasn\'t cooled all night and it isn\'t on any timetable."'),
      t('"Don\'t walk down to it. And tell Eunice the tickets were in my coat the whole time. She\'ll be fretting."'),
    ],
    reward: { note: [msg('Service Tunnel'), msg('An engine idles at the far end of the tunnel. It has not cooled all night and it is on no timetable.')] },
  },
  {
    id: 'dwight',
    name: msg('Dwight Mallory'),
    item: msg('A service ribbon in a cellophane sleeve'),
    itemId: 'ribbon',
    where: { room: 'manager', x: -20.4, z: -12.8, yaw: 0.9 },
    mutter: [
      t('Two years in, thirty days leave, one bus.'),
      t('He wasn\'t lying to us. That\'s the part I can\'t put down.'),
      t('He stamped the boy through. His own kin.'),
    ],
    story: [
      t('"Eleven hours from my mother\'s kitchen table. I had the leave papers folded in my breast pocket."'),
      t('"The attendant knew that bus was wrong. I watched his hands shake on the punch out at Bay 9."'),
      t('"He sent his own nephew aboard anyway. Whatever he\'s keeping off us, he\'s more afraid of it than that."'),
    ],
    reward: { note: [msg('Walter Penn'), msg('Walter knew the 11:47 was wrong and stamped his own nephew aboard regardless. Something frightens him more.')] },
  },
  {
    id: 'otis',
    name: msg('Otis Lemay'),
    item: msg('A saxophone mouthpiece, bitten through'),
    itemId: 'mouthpiece',
    // On the end stool, facing the counter.
    where: { room: 'diner', x: 20.1, z: 4.3, yaw: 0, seat: 0.785 },
    mutter: [
      t('Third button, second row. Not my song, but it\'s a good one.'),
      t('That box eats dimes on anything cut after \'79.'),
      t('While the music\'s on, nothing in here can hear you.'),
    ],
    story: [
      t('"Six nights a week in rooms with no windows. A man on the coast had a room with a window in it."'),
      t('"The jukebox is louder than this whole building. Put a record on and the hall goes deaf for the length of it."'),
      t('"Deaf includes the attendant. It includes you too, so count the song out. Don\'t listen for him."'),
    ],
    reward: { note: [msg('Jukebox'), msg('While a record is playing the Attendant cannot hear you — and you cannot hear him either. Count the song.')] },
  },
  {
    id: 'claudette',
    name: msg('Claudette Ferry'),
    item: msg('A funeral program, folded to the hymn'),
    itemId: 'program',
    // Front row, as if the service might still start without her.
    where: { room: 'hall', x: -7.6, z: -1.58, yaw: Math.PI, seat: 0.465 },
    mutter: [
      t('I\'m not late. The service isn\'t until Thursday.'),
      t('It\'s already Thursday somewhere.'),
      t('They were going to hold the second hymn for me.'),
    ],
    story: [
      t('"Mother died on the Sunday. I took the last seat on the 11:47, the narrow one over the wheel."'),
      t('"Nobody has read my name off that PA all night. I have listened for it on every single hour."'),
      t('"They only call the names that nobody is expecting. So they are never going to call mine."'),
    ],
    reward: { note: [msg('The PA'), msg('The announcer only calls names nobody is waiting for. If you hear your own, no one is expecting you.')] },
  },
];

// The papers lying about the station. Each line is what is on the page:
// a plain string is printed or typed (or, on a note, written), { hand } was
// written on afterwards by someone else, and { say } is not on the page at all
// but is what you notice about it, given as a subtitle while you read.
export const DOCUMENTS = {
  nightlog: {
    title: t("Night Log — W. Penn"),
    lines: (loop) => [
      t('OCT 29 1987 — Quiet. Four passengers. Heater out in the hall again.'),
      t('NOV 01 1987 — Mrs Vance asked for her song. Played it twice.'),
      t('NOV 03 1987 — 14 on the 11:47. Stamped them all. Bay 9.'),
      t('NOV 03 1987 — Bus pulled out 11:51. I stayed to lock up.'),
      t('NOV 04 1987 — No bus came back. No wreck. Board still shows it departed.'),
      t('NOV 11 1987 — I cannot leave the building. I have tried the doors.'),
      t('NOV 30 1987 — Someone is adding rules to my sign. They are not my rules.'),
      t('DEC ?? ---- — A sleeper on the bench tonight. That makes {n}.', { n: loop }),
      t('DEC ?? ---- — If you are reading this: do not obey all of it. Some of it is bait.'),
    ],
  },
  clipping: {
    title: 'Grayhollow Sentinel',
    headline: t('BUS, 14 PASSENGERS MISSING ON COAST ROUTE'),
    lines: (loop) => [
      t('November 5, 1987 — State police have found no trace of the 11:47 service from Grayhollow Transit Center, which departed Bay 9 on Tuesday night.'),
      t('The night attendant, W. Penn, told officers he stamped fourteen fares and watched the coach pull out at 11:51. He has not been reached for further comment.'),
      t('No wreckage has been found on the coast road. The departure board at the terminal continues to list the service as departed.'),
      t('Search parties will resume at first light. Anyone with information is asked to contact the county sheriff.'),
      {
        say: loop <= 1
          ? t('The photograph shows an empty loading platform.')
          : loop === 2
          ? t('In the photograph, a figure in a transit cap stands at the edge of Bay 9.')
          : loop === 3
          ? t('In the photograph, the figure has turned to face the camera.')
          : t('In the photograph, someone is sitting on the bench. They are wearing your clothes.'),
      },
    ],
  },
  postcards: {
    title: t('Postcards, Never Sent'),
    cards: [
      { to: 'D. Krenshaw', text: t('The belts can run without you for one week. Come down.') },
      { to: 'M. Vance', text: t('Saved you a slot on Friday. Bring the good dress.') },
      { to: t('Sister I. Ruiz'), text: t('The children ask about you. Travel safe.') },
      { to: 'T. Penn', text: t('Your uncle wrote that you are coming alone. Be brave.') },
      { to: 'N. Abbot', text: t('Your photographs came out. All but the last roll.') },
    ],
    say: t('None of them have stamps.'),
  },
  pascript: {
    title: t('PA Announcement Scripts'),
    lines: (loop, playerName = t('PASSENGER')) => [
      t('SCRIPT 1 — "The 11:47 service to the coast is now boarding at Bay 9."'),
      t('SCRIPT 4 — "Passengers are reminded not to leave baggage unattended."'),
      t('SCRIPT 9 — "Would {name} please come to the ticket office."', { name: playerName }),
      '',
      { hand: t('SCRIPT 12 — "Do not answer to your name." — W.P.') },
      { say: t('Script 9 is typed on the same page as the others, and the ink is not faded. It was typed tonight.') },
    ],
  },
  waltersletter: {
    title: t('A Letter in the Safe'),
    lines: () => [
      t('To whoever gets this far.'),
      '',
      t('I have stopped twelve of you now. You all think I am the thing to be afraid of.'),
      t('I am the thing that stands between you and the one on camera four.'),
      '',
      t('When I take your ticket I am putting you back at 11:47, where it cannot reach.'),
      t('That is all I can do. It is not much.'),
      '',
      t('If you want out properly: hear all fourteen of them. They will not go without being heard.'),
      t('Then there will be a slip in the box with your own name on it.'),
      '',
      t('I can stamp that one. — W. Penn, night attendant'),
    ],
  },
  handwritten: {
    title: t('A Handwritten Sign'),
    lines: () => [
      { say: t('Taped inside the end stall, in pencil.') },
      t('TWO OF THE RULES ON THE WALL ARE NOT OURS.'),
      t('ONE WANTS YOU BLIND. ONE WANTS YOU LIT UP.'),
      '',
      t('READ THE WALL IN THE GLASS AFTER TWO.'),
      '',
      '— I.R.',
    ],
  },
  workorder: {
    title: t('Work Order 4410 — Bay 9'),
    lines: (loop) => [
      t('GRAYHOLLOW TRANSIT CENTER — MAINTENANCE WORK ORDER 4410'),
      t('Raised OCT 18 1987 by D. KRENSHAW, belts & platform.'),
      t('Location: BAY 9 — platform lamp, door seal, thermocouple.'),
      '',
      t('FAULT 1 — Bay 9 runs three degrees colder than bays 1 through 8 with the doors shut.'),
      t('FAULT 2 — Platform lamp reads live with the breaker off. Do not re-lamp hot.'),
      t('FAULT 3 — Door seal worn on the outside face. Nothing outside to wear it on.'),
      '',
      t('PARTS: one seal, one lamp, one thermocouple. Received OCT 24. Signed for by W. PENN.'),
      t('WORK COMPLETED: ______________   SIGN OFF: ______________'),
      '',
      ...(loop <= 1
        ? [{ say: t('The parts are still in the box under the bench. The tape has never been cut.') }]
        : [
          { hand: loop === 2 ? t('NOT A FAULT.') : t('NOT A FAULT. DO NOT FIX. IT IS THE ONLY COLD DOOR.'), color: 'rgba(150,32,24,0.9)' },
          { say: t('Someone has written across the bottom of it in grease pencil.') },
        ]),
    ],
  },
  manifest: {
    title: t('Manifest — 11:47 PM Coast Service'),
    lines: (loop) => [
      t('GRAYHOLLOW TRANSIT — BAY 9 — 11:47 PM COAST SERVICE — NOV 03 1987'),
      t('Fares taken and stamped by W. PENN, night attendant. Fourteen aboard.'),
      '',
      t(' 1  VANCE, MARGUERITE ......... seat 2 .... paid'),
      t(' 2  KRENSHAW, DALE ............ seat 4 .... staff pass'),
      t(' 3  RUIZ, IMELDA (SISTER) ..... seat 5 .... paid'),
      t(' 4  PENN, TOBIAS .............. seat 7 .... half fare'),
      t(' 5  ABBOT, NINA ............... seat 9 .... paid'),
      t(' 6  TEAGUE, ROY ............... seat 11 ... paid'),
      t(' 7  FISK, LORRAINE ............ seat 12 ... paid'),
      t(' 8  MABRY, CURTIS ............. seat 14 ... no fare, see note'),
      t(' 9  HATCH, VERNON ............. seat 16 ... paid'),
      t('10  PIKE, EUNICE .............. seat 18 ... paid'),
      t('11  PIKE, HAROLD .............. seat 19 ... paid'),
      t('12  MALLORY, DWIGHT ........... seat 21 ... military rate'),
      t('13  LEMAY, OTIS ............... seat 24 ... paid'),
      { hand: t('14  FERRY, CLAUDETTE .......... seat 0 .... paid') },
      '',
      t('NOTE — No fare taken from 8. He is sixteen years of age. — W.P.'),
      '',
      t('TOTAL ABOARD .................. {n}', { n: loop <= 2 ? 14 : 15 }),
      t('Signed for by the driver.'),
      {
        say: loop <= 2
          ? t('There is no seat 0 on a coach of that model, and line fourteen is in a different hand. The driver signed for fourteen.')
          : t('There is no seat 0 on a coach of that model, and line fourteen is in a different hand. The driver signed for fourteen. The total at the foot of the page now reads fifteen.'),
      },
    ],
  },
  roster: {
    title: t('Night Duty Roster — Week of Nov 2, 1987'),
    lines: (loop) => [
      t('GRAYHOLLOW TRANSIT CENTER — NIGHT SERVICES — DRIVER ROSTER'),
      t('Week commencing MON NOV 02 1987. Depot manager: R. ASHCOMBE.'),
      '',
      t('MON   9:40 BAY 6 ... HALVERSON     11:20 BAY 7 ... DUQUESNE'),
      t('MON  11:47 BAY 9 ... MORROW'),
      t('TUE   9:40 BAY 6 ... HALVERSON     11:20 BAY 7 ... DUQUESNE'),
      t('TUE  11:47 BAY 9 ... NO DRIVER — SERVICE WITHDRAWN'),
      t('WED   9:40 BAY 6 ... HALVERSON     11:20 BAY 7 ... PIKE (relief)'),
      t('WED  11:47 BAY 9 ... SERVICE SUSPENDED UNTIL FURTHER NOTICE'),
      '',
      t('NOTE — Morrow off sick Tues. No relief available. The 11:47 is not to run.'),
      t('Night attendant to post the cancellation on the board and refund fares. — R.A.'),
      { hand: t('It came in at 11:40 anyway. Lights on, doors open, engine running.') },
      { hand: t('I never saw who was driving. I stamped them on because they had tickets. — W.P.') },
      ...(loop >= 3
        ? [{ hand: t('TUE  11:47 BAY 9 ... 0'), color: 'rgba(150,32,24,0.9)' },
          { say: t('In the driver column for Tuesday, under the cancellation, someone has pressed a single 0 into the paper hard enough to tear it.') }]
        : [{ say: t('Tuesday was the third. The 11:47 was cancelled before it ever arrived.') }]),
    ],
  },
  tobiasletter: {
    title: t('A Letter, Never Posted'),
    lines: () => [
      t('Dear Uncle Walt,'),
      t('Mom says I can come and stay at the coast with Aunt Ruth for the winter, and that'),
      t('you will put me on the bus yourself so I do not get lost. I will not get lost.'),
      '',
      t('Can I see the big board that flips? Can I wear your hat for one minute?'),
      t('Mom says you work nights because you like it quiet. I can be quiet.'),
      '',
      t('I am bringing my soldier. He is a sergeant.'),
      t('Love, Toby'),
      { say: t('It is addressed to W. Penn at the station, in a child\'s capitals. It was never stamped. Walter kept it anyway.') },
    ],
  },
  bench: {
    title: t('Under the Bench'),
    lines: (loop) => [
      { say: t('Scratched into the underside of the seat, in a lot of different hands. Keys, mostly. One in what looks like a fingernail.') },
      t('R.D. 1991 — WAITING FOR THE 6:10'),
      t('MAYBE IT IS ALWAYS THE SAME NIGHT'),
      'K.L. 2003  III',
      t('DONT ANSWER TO YOUR NAME'),
      t('it lets you go if you listen to them. all of them'),
      t('THE MAN IN THE CAP IS NOT THE ONE'),
      t('J. 2014 — saw a bus with no number. did not get on'),
      ...(loop >= 2
        ? [{ hand: '|'.repeat(Math.min(24, loop - 1)) },
          { say: loop === 2
            ? t('The newest mark is a single line, cut with a key. It is in your hand. You would know it anywhere.')
            : t('The newest marks are {n} lines, cut with a key. They are in your hand. You do not remember making any of them.', { n: Math.min(24, loop - 1) }) }]
        : [{ say: t('The newest of them is still bright where the key went in.') }]),
    ],
  },
};

export const PA_LINES = {
  ambient: [
    t('The 11:47 service to the coast is now boarding at Bay 9.'),
    t('Passengers are reminded that the terminal closes at no particular time.'),
    t('Lost property may be claimed by its owner, or by its owner.'),
    t('The 11:47 service to the coast is now boarding at Bay 9.'),
    t('Please do not leave your body unattended.'),
    t('Cleaning in progress on the lower level. There is no lower level.'),
    t('Thank you for waiting. Thank you for waiting. Thank you for waiting.'),
    t('Baggage Claim is now operating. Please collect only your own.'),
    t('Benches are provided for the comfort of passengers and for the counting of passengers.'),
    t('The night attendant is on his break. He has been on his break since November.'),
    t('Fourteen boarded at Bay 9. Fourteen are accounted for. Please stop asking at the window.'),
    t('A bus has been located. It is not the bus that is missing.'),
    t('Final call for the 11:47. Final call for the 11:47. There is no final call.'),
    t('Would passengers kindly stop arriving.'),
  ],
  // The lure: answering is a rule break.
  nameCall: [
    t('Would the passenger on bench four please come to the ticket office.'),
    t('Paging the passenger who has not bought a ticket. Please identify yourself.'),
    t('Would the owner of a hatbox please report to Bay 9 immediately.'),
    t('We are holding a message from someone at your home address. Say your name at the window to receive it.'),
    t('Will the fifteenth passenger please confirm the spelling for the manifest.'),
    t('If you can hear this, you are the one we mean. Answer in the usual way.'),
  ],
  lies: [
    t('All rules are suspended between two and three. Please proceed normally.'),
    t('The service door behind Baggage Claim is unlocked tonight.'),
    t('Running is permitted when the hall is empty.'),
  ],
  hiddenAnnouncement: [
    t('This is for the one who played the song.'),
    t('Walter keeps his ring on the hook in the security room.'),
    t('He is deaf to the jukebox. Use it.'),
  ],
};

export const ENDINGS = {
  coast: {
    id: 'coast',
    title: t('THE COAST'),
    kind: 'bad',
    kindLabel: t('BAD ENDING'),
    // Shown on the ending card while it is still to be found.
    hint: t('Board the 3:33 with a ticket that is not yours.'),
    lines: [
      t('You hand over a stranger\'s transfer. The Attendant looks at it for a long time.'),
      t('Then he punches it, and steps aside.'),
      '',
      t('The bus pulls out of Bay 9 into the fog. The seats are full. Nobody looks up.'),
      t('Somewhere around the third mile the engine noise stops.'),
      '',
      t('You wake up on the bench at 11:47 PM.'),
      t('The departure board lists fifteen passengers now. The last name is yours.'),
    ],
  },
  home: {
    id: 'home',
    title: t('HOME'),
    kind: 'good',
    kindLabel: t('GOOD ENDING'),
    hint: t('They will not go without being heard. None of them.'),
    lines: [
      t('You hand him the slip with your own name on it. Fourteen voices stop muttering at once.'),
      t('Walter stamps it, tips his cap, and does not follow you aboard.'),
      '',
      t('The bus climbs out of Grayhollow as the sky goes grey. The other seats empty one by one,'),
      t('each passenger stepping down at a stop that should not exist any more, and waving.'),
      '',
      t('You wake up at your own stop, in your own town, at dawn.'),
      t('There is a coin in your pocket, dated 1987, still warm.'),
    ],
  },
  nightshift: {
    id: 'nightshift',
    title: t('NIGHT SHIFT'),
    kind: 'bittersweet',
    kindLabel: t('BITTERSWEET ENDING'),
    hint: t('One man here has never had a ticket of his own.'),
    lines: [
      t('You hold out the ticket. Walter does not take it for a long moment.'),
      t('"That\'s mine?" he says. "That\'s actually mine?"'),
      '',
      t('He boards the 3:33 with his cap in his hands. Through the window he is already younger.'),
      t('The bus goes. The hall is very quiet.'),
      '',
      t('The uniform is folded on the ticket counter, and it is your size.'),
      t('At 11:47 PM someone new falls asleep on the bench, and you pick up the keyring,'),
      t('and you start writing the rules you wish somebody had written for you.'),
    ],
  },
  bay0: {
    id: 'bay0',
    title: t('BAY 0'),
    kind: 'secret',
    kindLabel: t('SECRET ENDING'),
    hint: t('Count the bays from outside. Then count the numbers.'),
    lines: [
      t('The tunnel ends at a loading platform with no number painted on it.'),
      t('A bus is idling. Its destination board is a single word in a script you do not know.'),
      '',
      t('The thing from camera four is already in the driver\'s seat. It has been waiting all night,'),
      t('one camera at a time, for someone curious enough to walk the service tunnel.'),
      '',
      t('It opens the doors.'),
      '',
      t('Through the windscreen you can see the next station, and the next, and the next:'),
      t('a thousand terminals strung along one road, each with a bench, each with a sleeper,'),
      t('each with a tired man in a cap who thinks his is the only one.'),
    ],
  },
};

// What comes back to you as you wake on the bench. The first night the
// station introduces itself. After that, something of how the last night
// ended is still with you, and one more thing of your own has come back.
export const WAKE = {
  first: [
    t('You only meant to rest your eyes between coaches.'),
    t('Grayhollow Transit Center. One change, an hour at most, and then the coast road home.'),
    t('It is colder than when you sat down. Somebody has turned off the heating, or the year.'),
  ],
  after: {
    caught: [
      t('There is a neat round hole punched through your ticket stub. You did not punch it.'),
      t('You remember his hand on your shoulder. Cold through the coat, and very gentle.'),
      t('Your wrist aches where something held it. The skin there is colder than the rest of you.'),
    ],
    departed: [
      t('You can still smell diesel. In your sleep, a coach left Bay 9 without you.'),
      t('The 3:33 went without you. The bench does not seem to mind.'),
    ],
    coast: [
      t('Your coat is damp with fog you never walked through.'),
      t('You can still hear the engine stop. Then nothing at all, for a long time.'),
    ],
    home: [
      t('You were home. You are sure you were home. The coin in your pocket is still warm.'),
      t('There was a kitchen with the light left on for you. It is already going, the way dreams go.'),
    ],
    nightshift: [
      t('Your hands remember the weight of a keyring. Someone else is wearing the cap tonight.'),
      t('For a while you kept the station. Then somebody fell asleep on the bench, and it was you.'),
    ],
    bay0: [
      t('You saw a thousand benches through that windscreen. This is only one of them.'),
      t('Somewhere down a road with no numbers, a door is still open, waiting for you to finish waking.'),
    ],
  },
  // One more for each night: by the second night, the first of these.
  memories: [
    t('You have done this before. The same stiff neck. The same water stain on the ceiling, shaped like a hand.'),
    t('You remember why you came. A message on the machine, in your sister\'s voice: "Come home. It\'s time."'),
    t('Eleven years since you were last home. You bought the ticket that night, before you could talk yourself out of it.'),
    t('Three coaches to get this far. You kept every stub. There are only two in your pocket.'),
    t('The coach in from the city was late. You stepped down into this hall, and the clock said 11:47.'),
    t('You remember the date on your ticket now. It was not 1987. It was not anywhere near 1987.'),
    t('The PA calls your name, and Claudette says it only calls the ones nobody is expecting. Your sister is expecting you. You are almost sure.'),
    t('You have started to know their faces better than your own. Marguerite hums when she thinks no one is listening.'),
    t('Every night the man in the cap looks at you a little longer before he does anything at all.'),
  ],
  // Past the end of those, one of these.
  later: [
    t('The bench has a dip in it the shape of you now.'),
    t('You stopped counting the nights. The underside of the bench has not.'),
    t('Your sister\'s voice on the machine is getting harder to hear. You keep the words anyway: come home.'),
  ],
  end: (loop) => loop <= 1
    ? t('11:47 PM. The last coach to the coast leaves Bay 9 at 3:33. You will need a valid ticket.')
    : t('11:47 PM. Again.'),
};
