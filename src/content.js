// All the writing lives here: the fourteen passengers (five of whom you can
// actually reach in this build), the paper you find, and what the PA says.

export const LOCKER_CODE = 'GRAY';

// "A hatbox, crushed on one side" -> "the hatbox, crushed on one side".
export const theItem = (item) => `the ${item.replace(/^an? /i, '')}`.toLowerCase();

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
    name: 'Marguerite Vance',
    item: 'A hatbox, crushed on one side',
    itemId: 'hatbox',
    // Sitting on the back row of benches, facing the south wall.
    where: { room: 'hall', x: -5.4, z: 5.42, yaw: Math.PI, seat: 0.465 },
    mutter: [
      'I only sat down for a minute.',
      'They said the coast is warmer.',
      'Have you heard the one about the hollow moon?',
    ],
    story: [
      '"I was going to sing. Properly, I mean, on a stage with a curtain."',
      '"Walter used to put my song on the jukebox when the hall was empty."',
      '"Hollow Moon. Third button, second row. He always knew."',
    ],
    reward: { note: ['Jukebox', 'Marguerite\'s song is "Hollow Moon" — third button, second row.'], code: ['jukebox', 'B3'] },
  },
  {
    id: 'dale',
    name: 'Dale Krenshaw',
    item: 'A dented steel thermos',
    itemId: 'thermos',
    where: { room: 'bays', x: 6, z: -29, yaw: Math.PI },
    mutter: [
      'Bus is late. Bus is always late.',
      'I keep the belts running. Somebody has to.',
      'Don\'t go in the back if you don\'t have the keys.',
    ],
    story: [
      '"Thirty-one years on the belts. I knew every inch of the back of this place."',
      '"There\'s a service door behind Baggage, east wall. Walter\'s ring opens it."',
      '"It goes somewhere that isn\'t on the map. I never walked all the way down."',
    ],
    reward: { note: ['Station', 'A locked service door on the east wall of Baggage Claim. The keyring opens it.'], flag: 'tunnelFound' },
  },
  {
    id: 'imelda',
    name: 'Sister Imelda Ruiz',
    item: 'A rosary, two beads missing',
    itemId: 'rosary',
    where: { room: 'restroom', x: -4, z: 13, yaw: -1.2 },
    mutter: [
      'I read the signs. I read them very carefully.',
      'Not all of it was written by the same hand.',
      'After two, look in the glass.',
    ],
    story: [
      '"Somebody else has been adding rules. The letters lean the wrong way."',
      '"The mirrors in here do not lie. The walls do."',
      '"After two in the morning, read the signs in the glass. You will see which ones are not real."',
    ],
    reward: { note: ['Rules', 'After 2:00 AM the restroom mirror shows which posted rules are false.'] },
  },
  {
    id: 'tobias',
    name: 'Tobias Penn',
    item: 'A lead soldier, paint worn off',
    itemId: 'soldier',
    where: { room: 'ticket', x: -14.6, z: -7, yaw: 1.6 },
    mutter: [
      'My uncle works here. He has a hat and everything.',
      'He said he\'d be right behind me.',
      'The clock upstairs is stuck.',
    ],
    story: [
      '"Uncle Walter stamped my ticket himself. He said he\'d get the next one."',
      '"He keeps a safe under the floor in his office. The stopped clock opens it."',
      '"Set it to when the bus left. He checks it every night. Every single night."',
    ],
    reward: { note: ['Manager\'s Office', 'The stopped clock opens the floor safe. Set it to 11:47.'], flag: 'managerFound' },
  },
  {
    id: 'nina',
    name: 'Nina Abbot',
    item: 'A camera with film still in it',
    itemId: 'camera',
    where: { room: 'diner', x: 15, z: 7.4, yaw: -2.4 },
    mutter: [
      'I photograph buildings. This one photographs back.',
      'There\'s a bay they painted over.',
      'Camera four sees more than four things.',
    ],
    story: [
      '"I counted the bays from outside. There are ten doors and nine numbers."',
      '"The tenth is at the end of the service tunnel. They stopped numbering it."',
      '"Whatever walks the cameras is going there. It has been getting closer all night."',
    ],
    reward: { note: ['Bay 0', 'There is a tenth bay at the end of the service tunnel. It has no number.'] },
  },
  {
    id: 'roy',
    name: 'Roy Teague',
    item: 'A trucker\'s logbook, last page blank',
    itemId: 'logbook',
    where: { room: 'gate', x: -1, z: -17, yaw: 0 },
    mutter: [
      'Twenty-two hours up. I only shut my eyes at the light.',
      'You can\'t deadhead a bus. A bus has to be full.',
      'It\'s longer going back than it was coming out.',
    ],
    story: [
      '"Nineteen years hauling freight and this was the first time I rode instead of drove. Her birthday."',
      '"Count your steps down this corridor. Forty going out. If it\'s forty-four coming back, stop."',
      '"That\'s the night taking a bite out of the middle. Turn around and start the count again."',
    ],
    reward: { note: ['Gate Corridor', 'Count your steps in the gate corridor. If the way back runs longer than the way out, turn around.'] },
  },
  {
    id: 'lorraine',
    name: 'Lorraine Fisk',
    item: 'A nurse\'s fob watch, pinned upside down',
    itemId: 'fobwatch',
    where: { room: 'cctv', x: 19.4, z: -5.4, yaw: -0.8 },
    mutter: [
      'Double shift. I can sleep sitting up with my eyes open.',
      'Thirty-eight. Thirty-nine. Forty.',
      'Camera four is panning again. Nobody told it to.',
    ],
    story: [
      '"Sixteen hours at Mercy, then the coast to meet my sister\'s baby. I had a little bear in my bag for her."',
      '"Nine cameras, nine monitors. When one goes to snow, the thing has stepped out of that picture."',
      '"Forty seconds and it\'s in the next room. I count for it now. Out loud. It likes being counted for."',
    ],
    reward: { note: ['Camera Four', 'A monitor turning to snow means the thing has left that picture. You have about forty seconds.'] },
  },
  {
    id: 'curtis',
    name: 'Curtis Mabry',
    item: 'A duffel bag with a boy\'s name inked inside',
    itemId: 'duffel',
    where: { room: 'lostfound', x: -20, z: 3, yaw: 1.9 },
    mutter: [
      'I\'m sixteen. I\'ll be seventeen in the spring.',
      'He let me on without a fare. He just looked at me a while.',
      'Don\'t take anything off the bottom row.',
    ],
    story: [
      '"Eleven dollars, one bag, and nobody at home who was going to miss the quiet I left behind."',
      '"The attendant never asked me for a fare. He wrote me in the book anyway, so I\'d count as somebody."',
      '"Bottom shelf in here is the unclaimed. Some of those tags have years on them that haven\'t come yet."',
    ],
    reward: { note: ['Lost & Found', 'The bottom shelf is unclaimed property. Some of the tags are dated years that have not happened.'] },
  },
  {
    id: 'vernon',
    name: 'Vernon Hatch',
    item: 'A salesman\'s case of buttons',
    itemId: 'samplecase',
    where: { room: 'hall', x: 8, z: -6, yaw: 2.2 },
    mutter: [
      'Buttons. Everybody needs buttons. Recession-proof line.',
      'I had a nine o\'clock in Yarrow Bend. I had.',
      'Gloversville. Redhill. Ashton. Yarrow. Gloversville. Redhill —',
    ],
    story: [
      '"Twenty-six towns a month. Not one of them would notice if I stopped coming, and here we are."',
      '"I know that board by heart. Four cancelled tonight: Gloversville, Redhill, Ashton Fork, Yarrow Bend."',
      '"Take the first letter off each, in the order the board gives them. It opens a locker that isn\'t mine."',
    ],
    reward: { note: ['Departure Board', 'The cancelled destinations, read in board order, spell a four-letter locker code.'] },
  },
  {
    id: 'eunice',
    name: 'Eunice Pike',
    item: 'A paper bag of boiled sweets',
    itemId: 'sweets',
    where: { room: 'baggage', x: 4.6, z: 13, yaw: 2.7 },
    mutter: [
      'Harold has the tickets. Harold always has the tickets.',
      'He only went to see about the cases.',
      'Forty-one years and I have never had to wait this long for him.',
    ],
    story: [
      '"The coast, for our anniversary. Harold went to see about the cases and he did not come back for me."',
      '"The carousel runs on the hour. Ours never comes round again — it goes past the rubber flap and out."',
      '"My husband followed our luggage through there. If you find him, tell him I stayed where he left me."',
    ],
    reward: { note: ['Baggage Claim', 'The carousel runs on the hour. Anything that passes the rubber flap does not come back around.'] },
  },
  {
    id: 'harold',
    name: 'Harold Pike',
    item: 'A pair of reading glasses, one lens cracked',
    itemId: 'glasses',
    where: { room: 'tunnel', x: 25, z: 17, yaw: -1.5 },
    mutter: [
      'The cases came through here. I could hear the wheels on the concrete.',
      'There\'s a light at the far end. It idles.',
      'Eunice will be worried. Eunice does worry.',
    ],
    story: [
      '"I came in after the cases and the door shut polite behind me, the way it does when a man holds it."',
      '"There\'s an engine running at the far end. It hasn\'t cooled all night and it isn\'t on any timetable."',
      '"Don\'t walk down to it. And tell Eunice the tickets were in my coat the whole time. She\'ll be fretting."',
    ],
    reward: { note: ['Service Tunnel', 'An engine idles at the far end of the tunnel. It has not cooled all night and it is on no timetable.'] },
  },
  {
    id: 'dwight',
    name: 'Dwight Mallory',
    item: 'A service ribbon in a cellophane sleeve',
    itemId: 'ribbon',
    where: { room: 'manager', x: -20.4, z: -12.8, yaw: 0.9 },
    mutter: [
      'Two years in, thirty days leave, one bus.',
      'He wasn\'t lying to us. That\'s the part I can\'t put down.',
      'He stamped the boy through. His own kin.',
    ],
    story: [
      '"Eleven hours from my mother\'s kitchen table. I had the leave papers folded in my breast pocket."',
      '"The attendant knew that bus was wrong. I watched his hands shake on the punch out at Bay 9."',
      '"He sent his own nephew aboard anyway. Whatever he\'s keeping off us, he\'s more afraid of it than that."',
    ],
    reward: { note: ['Walter Penn', 'Walter knew the 11:47 was wrong and stamped his own nephew aboard regardless. Something frightens him more.'] },
  },
  {
    id: 'otis',
    name: 'Otis Lemay',
    item: 'A saxophone mouthpiece, bitten through',
    itemId: 'mouthpiece',
    // On the end stool, facing the counter.
    where: { room: 'diner', x: 20.1, z: 4.3, yaw: 0, seat: 0.785 },
    mutter: [
      'Third button, second row. Not my song, but it\'s a good one.',
      'That box eats dimes on anything cut after \'79.',
      'While the music\'s on, nothing in here can hear you.',
    ],
    story: [
      '"Six nights a week in rooms with no windows. A man on the coast had a room with a window in it."',
      '"The jukebox is louder than this whole building. Put a record on and the hall goes deaf for the length of it."',
      '"Deaf includes the attendant. It includes you too, so count the song out. Don\'t listen for him."',
    ],
    reward: { note: ['Jukebox', 'While a record is playing the Attendant cannot hear you — and you cannot hear him either. Count the song.'] },
  },
  {
    id: 'claudette',
    name: 'Claudette Ferry',
    item: 'A funeral program, folded to the hymn',
    itemId: 'program',
    // Front row, as if the service might still start without her.
    where: { room: 'hall', x: -7.6, z: -1.58, yaw: Math.PI, seat: 0.465 },
    mutter: [
      'I\'m not late. The service isn\'t until Thursday.',
      'It\'s already Thursday somewhere.',
      'They were going to hold the second hymn for me.',
    ],
    story: [
      '"Mother died on the Sunday. I took the last seat on the 11:47, the narrow one over the wheel."',
      '"Nobody has read my name off that PA all night. I have listened for it on every single hour."',
      '"They only call the names that nobody is expecting. So they are never going to call mine."',
    ],
    reward: { note: ['The PA', 'The announcer only calls names nobody is waiting for. If you hear your own, no one is expecting you.'] },
  },
];

// The papers lying about the station. Each line is what is on the page:
// a plain string is printed or typed (or, on a note, written), { hand } was
// written on afterwards by someone else, and { say } is not on the page at all
// but is what you notice about it, given as a subtitle while you read.
export const DOCUMENTS = {
  nightlog: {
    title: "Night Log — W. Penn",
    lines: (loop) => [
      'OCT 29 1987 — Quiet. Four passengers. Heater out in the hall again.',
      'NOV 01 1987 — Mrs Vance asked for her song. Played it twice.',
      'NOV 03 1987 — 14 on the 11:47. Stamped them all. Bay 9.',
      'NOV 03 1987 — Bus pulled out 11:51. I stayed to lock up.',
      'NOV 04 1987 — No bus came back. No wreck. Board still shows it departed.',
      'NOV 11 1987 — I cannot leave the building. I have tried the doors.',
      'NOV 30 1987 — Someone is adding rules to my sign. They are not my rules.',
      'DEC ?? ---- — A sleeper on the bench tonight. That makes ' + loop + '.',
      'DEC ?? ---- — If you are reading this: do not obey all of it. Some of it is bait.',
    ],
  },
  clipping: {
    title: 'Grayhollow Sentinel',
    headline: 'BUS, 14 PASSENGERS MISSING ON COAST ROUTE',
    lines: (loop) => [
      'November 5, 1987 — State police have found no trace of the 11:47 service from Grayhollow Transit Center, which departed Bay 9 on Tuesday night.',
      'The night attendant, W. Penn, told officers he stamped fourteen fares and watched the coach pull out at 11:51. He has not been reached for further comment.',
      'No wreckage has been found on the coast road. The departure board at the terminal continues to list the service as departed.',
      'Search parties will resume at first light. Anyone with information is asked to contact the county sheriff.',
      {
        say: loop <= 1
          ? 'The photograph shows an empty loading platform.'
          : loop === 2
          ? 'In the photograph, a figure in a transit cap stands at the edge of Bay 9.'
          : loop === 3
          ? 'In the photograph, the figure has turned to face the camera.'
          : 'In the photograph, someone is sitting on the bench. They are wearing your clothes.',
      },
    ],
  },
  postcards: {
    title: 'Postcards, Never Sent',
    cards: [
      { to: 'D. Krenshaw', text: 'The belts can run without you for one week. Come down.' },
      { to: 'M. Vance', text: 'Saved you a slot on Friday. Bring the good dress.' },
      { to: 'Sister I. Ruiz', text: 'The children ask about you. Travel safe.' },
      { to: 'T. Penn', text: 'Your uncle wrote that you are coming alone. Be brave.' },
      { to: 'N. Abbot', text: 'Your photographs came out. All but the last roll.' },
    ],
    say: 'None of them have stamps.',
  },
  pascript: {
    title: 'PA Announcement Scripts',
    lines: (loop, playerName = 'PASSENGER') => [
      'SCRIPT 1 — "The 11:47 service to the coast is now boarding at Bay 9."',
      'SCRIPT 4 — "Passengers are reminded not to leave baggage unattended."',
      'SCRIPT 9 — "Would ' + playerName + ' please come to the ticket office."',
      '',
      { hand: 'SCRIPT 12 — "Do not answer to your name." — W.P.' },
      { say: 'Script 9 is typed on the same page as the others, and the ink is not faded. It was typed tonight.' },
    ],
  },
  waltersletter: {
    title: 'A Letter in the Safe',
    lines: () => [
      'To whoever gets this far.',
      '',
      'I have stopped twelve of you now. You all think I am the thing to be afraid of.',
      'I am the thing that stands between you and the one on camera four.',
      '',
      'When I take your ticket I am putting you back at 11:47, where it cannot reach.',
      'That is all I can do. It is not much.',
      '',
      'If you want out properly: hear all fourteen of them. They will not go without being heard.',
      'Then there will be a slip in the box with your own name on it.',
      '',
      'I can stamp that one. — W. Penn, night attendant',
    ],
  },
  handwritten: {
    title: 'A Handwritten Sign',
    lines: () => [
      { say: 'Taped inside the end stall, in pencil.' },
      'TWO OF THE RULES ON THE WALL ARE NOT OURS.',
      'ONE WANTS YOU BLIND. ONE WANTS YOU LIT UP.',
      '',
      'READ THE WALL IN THE GLASS AFTER TWO.',
      '',
      '— I.R.',
    ],
  },
  workorder: {
    title: 'Work Order 4410 — Bay 9',
    lines: (loop) => [
      'GRAYHOLLOW TRANSIT CENTER — MAINTENANCE WORK ORDER 4410',
      'Raised OCT 18 1987 by D. KRENSHAW, belts & platform.',
      'Location: BAY 9 — platform lamp, door seal, thermocouple.',
      '',
      'FAULT 1 — Bay 9 runs three degrees colder than bays 1 through 8 with the doors shut.',
      'FAULT 2 — Platform lamp reads live with the breaker off. Do not re-lamp hot.',
      'FAULT 3 — Door seal worn on the outside face. Nothing outside to wear it on.',
      '',
      'PARTS: one seal, one lamp, one thermocouple. Received OCT 24. Signed for by W. PENN.',
      'WORK COMPLETED: ______________   SIGN OFF: ______________',
      '',
      ...(loop <= 1
        ? [{ say: 'The parts are still in the box under the bench. The tape has never been cut.' }]
        : [
          { hand: loop === 2 ? 'NOT A FAULT.' : 'NOT A FAULT. DO NOT FIX. IT IS THE ONLY COLD DOOR.', color: 'rgba(150,32,24,0.9)' },
          { say: 'Someone has written across the bottom of it in grease pencil.' },
        ]),
    ],
  },
  manifest: {
    title: 'Manifest — 11:47 PM Coast Service',
    lines: (loop) => [
      'GRAYHOLLOW TRANSIT — BAY 9 — 11:47 PM COAST SERVICE — NOV 03 1987',
      'Fares taken and stamped by W. PENN, night attendant. Fourteen aboard.',
      '',
      ' 1  VANCE, MARGUERITE ......... seat 2 .... paid',
      ' 2  KRENSHAW, DALE ............ seat 4 .... staff pass',
      ' 3  RUIZ, IMELDA (SISTER) ..... seat 5 .... paid',
      ' 4  PENN, TOBIAS .............. seat 7 .... half fare',
      ' 5  ABBOT, NINA ............... seat 9 .... paid',
      ' 6  TEAGUE, ROY ............... seat 11 ... paid',
      ' 7  FISK, LORRAINE ............ seat 12 ... paid',
      ' 8  MABRY, CURTIS ............. seat 14 ... no fare, see note',
      ' 9  HATCH, VERNON ............. seat 16 ... paid',
      '10  PIKE, EUNICE .............. seat 18 ... paid',
      '11  PIKE, HAROLD .............. seat 19 ... paid',
      '12  MALLORY, DWIGHT ........... seat 21 ... military rate',
      '13  LEMAY, OTIS ............... seat 24 ... paid',
      { hand: '14  FERRY, CLAUDETTE .......... seat 0 .... paid' },
      '',
      'NOTE — No fare taken from 8. He is sixteen years of age. — W.P.',
      '',
      'TOTAL ABOARD .................. ' + (loop <= 2 ? '14' : '15'),
      'Signed for by the driver.',
      {
        say: loop <= 2
          ? 'There is no seat 0 on a coach of that model, and line fourteen is in a different hand. The driver signed for fourteen.'
          : 'There is no seat 0 on a coach of that model, and line fourteen is in a different hand. The driver signed for fourteen. The total at the foot of the page now reads fifteen.',
      },
    ],
  },
  roster: {
    title: 'Night Duty Roster — Week of Nov 2, 1987',
    lines: (loop) => [
      'GRAYHOLLOW TRANSIT CENTER — NIGHT SERVICES — DRIVER ROSTER',
      'Week commencing MON NOV 02 1987. Depot manager: R. ASHCOMBE.',
      '',
      'MON   9:40 BAY 6 ... HALVERSON     11:20 BAY 7 ... DUQUESNE',
      'MON  11:47 BAY 9 ... MORROW',
      'TUE   9:40 BAY 6 ... HALVERSON     11:20 BAY 7 ... DUQUESNE',
      'TUE  11:47 BAY 9 ... NO DRIVER — SERVICE WITHDRAWN',
      'WED   9:40 BAY 6 ... HALVERSON     11:20 BAY 7 ... PIKE (relief)',
      'WED  11:47 BAY 9 ... SERVICE SUSPENDED UNTIL FURTHER NOTICE',
      '',
      'NOTE — Morrow off sick Tues. No relief available. The 11:47 is not to run.',
      'Night attendant to post the cancellation on the board and refund fares. — R.A.',
      { hand: 'It came in at 11:40 anyway. Lights on, doors open, engine running.' },
      { hand: 'I never saw who was driving. I stamped them on because they had tickets. — W.P.' },
      ...(loop >= 3
        ? [{ hand: 'TUE  11:47 BAY 9 ... 0', color: 'rgba(150,32,24,0.9)' },
          { say: 'In the driver column for Tuesday, under the cancellation, someone has pressed a single 0 into the paper hard enough to tear it.' }]
        : [{ say: 'Tuesday was the third. The 11:47 was cancelled before it ever arrived.' }]),
    ],
  },
  tobiasletter: {
    title: 'A Letter, Never Posted',
    lines: () => [
      'Dear Uncle Walt,',
      'Mom says I can come and stay at the coast with Aunt Ruth for the winter, and that',
      'you will put me on the bus yourself so I do not get lost. I will not get lost.',
      '',
      'Can I see the big board that flips? Can I wear your hat for one minute?',
      'Mom says you work nights because you like it quiet. I can be quiet.',
      '',
      'I am bringing my soldier. He is a sergeant.',
      'Love, Toby',
      { say: 'It is addressed to W. Penn at the station, in a child\'s capitals. It was never stamped. Walter kept it anyway.' },
    ],
  },
  bench: {
    title: 'Under the Bench',
    lines: (loop) => [
      { say: 'Scratched into the underside of the seat, in a lot of different hands. Keys, mostly. One in what looks like a fingernail.' },
      'R.D. 1991 — WAITING FOR THE 6:10',
      'MAYBE IT IS ALWAYS THE SAME NIGHT',
      'K.L. 2003  III',
      'DONT ANSWER TO YOUR NAME',
      'it lets you go if you listen to them. all of them',
      'THE MAN IN THE CAP IS NOT THE ONE',
      'J. 2014 — saw a bus with no number. did not get on',
      ...(loop >= 2
        ? [{ hand: '|'.repeat(Math.min(24, loop - 1)) },
          { say: loop === 2
            ? 'The newest mark is a single line, cut with a key. It is in your hand. You would know it anywhere.'
            : `The newest marks are ${Math.min(24, loop - 1)} lines, cut with a key. They are in your hand. You do not remember making any of them.` }]
        : [{ say: 'The newest of them is still bright where the key went in.' }]),
    ],
  },
};

export const PA_LINES = {
  ambient: [
    'The 11:47 service to the coast is now boarding at Bay 9.',
    'Passengers are reminded that the terminal closes at no particular time.',
    'Lost property may be claimed by its owner, or by its owner.',
    'The 11:47 service to the coast is now boarding at Bay 9.',
    'Please do not leave your body unattended.',
    'Cleaning in progress on the lower level. There is no lower level.',
    'Thank you for waiting. Thank you for waiting. Thank you for waiting.',
    'Baggage Claim is now operating. Please collect only your own.',
    'Benches are provided for the comfort of passengers and for the counting of passengers.',
    'The night attendant is on his break. He has been on his break since November.',
    'Fourteen boarded at Bay 9. Fourteen are accounted for. Please stop asking at the window.',
    'A bus has been located. It is not the bus that is missing.',
    'Final call for the 11:47. Final call for the 11:47. There is no final call.',
    'Would passengers kindly stop arriving.',
  ],
  // The lure: answering is a rule break.
  nameCall: [
    'Would the passenger on bench four please come to the ticket office.',
    'Paging the passenger who has not bought a ticket. Please identify yourself.',
    'Would the owner of a hatbox please report to Bay 9 immediately.',
    'We are holding a message from someone at your home address. Say your name at the window to receive it.',
    'Will the fifteenth passenger please confirm the spelling for the manifest.',
    'If you can hear this, you are the one we mean. Answer in the usual way.',
  ],
  lies: [
    'All rules are suspended between two and three. Please proceed normally.',
    'The service door behind Baggage Claim is unlocked tonight.',
    'Running is permitted when the hall is empty.',
  ],
  hiddenAnnouncement: [
    'This is for the one who played the song.',
    'Walter keeps his ring on the hook in the security room.',
    'He is deaf to the jukebox. Use it.',
  ],
};

export const ENDINGS = {
  coast: {
    id: 'coast',
    title: 'THE COAST',
    kind: 'bad',
    lines: [
      'You hand over a stranger\'s transfer. The Attendant looks at it for a long time.',
      'Then he punches it, and steps aside.',
      '',
      'The bus pulls out of Bay 9 into the fog. The seats are full. Nobody looks up.',
      'Somewhere around the third mile the engine noise stops.',
      '',
      'You wake up on the bench at 11:47 PM.',
      'The departure board lists fifteen passengers now. The last name is yours.',
    ],
  },
  home: {
    id: 'home',
    title: 'HOME',
    kind: 'good',
    lines: [
      'You hand him the slip with your own name on it. Fourteen voices stop muttering at once.',
      'Walter stamps it, tips his cap, and does not follow you aboard.',
      '',
      'The bus climbs out of Grayhollow as the sky goes grey. The other seats empty one by one,',
      'each passenger stepping down at a stop that should not exist any more, and waving.',
      '',
      'You wake up at your own stop, in your own town, at dawn.',
      'There is a coin in your pocket, dated 1987, still warm.',
    ],
  },
  nightshift: {
    id: 'nightshift',
    title: 'NIGHT SHIFT',
    kind: 'bittersweet',
    lines: [
      'You hold out the ticket. Walter does not take it for a long moment.',
      '"That\'s mine?" he says. "That\'s actually mine?"',
      '',
      'He boards the 3:33 with his cap in his hands. Through the window he is already younger.',
      'The bus goes. The hall is very quiet.',
      '',
      'The uniform is folded on the ticket counter, and it is your size.',
      'At 11:47 PM someone new falls asleep on the bench, and you pick up the keyring,',
      'and you start writing the rules you wish somebody had written for you.',
    ],
  },
  bay0: {
    id: 'bay0',
    title: 'BAY 0',
    kind: 'secret',
    lines: [
      'The tunnel ends at a loading platform with no number painted on it.',
      'A bus is idling. Its destination board is a single word in a script you do not know.',
      '',
      'The thing from camera four is already in the driver\'s seat. It has been waiting all night,',
      'one camera at a time, for someone curious enough to walk the service tunnel.',
      '',
      'It opens the doors.',
      '',
      'Through the windscreen you can see the next station, and the next, and the next:',
      'a thousand terminals strung along one road, each with a bench, each with a sleeper,',
      'each with a tired man in a cap who thinks his is the only one.',
    ],
  },
};

// What comes back to you as you wake on the bench. The first night the
// station introduces itself. After that, something of how the last night
// ended is still with you, and one more thing of your own has come back.
export const WAKE = {
  first: [
    'You only meant to rest your eyes between coaches.',
    'Grayhollow Transit Center. One change, an hour at most, and then the coast road home.',
    'It is colder than when you sat down. Somebody has turned off the heating, or the year.',
  ],
  after: {
    caught: [
      'There is a neat round hole punched through your ticket stub. You did not punch it.',
      'You remember his hand on your shoulder. Cold through the coat, and very gentle.',
      'Your wrist aches where something held it. The skin there is colder than the rest of you.',
    ],
    departed: [
      'You can still smell diesel. In your sleep, a coach left Bay 9 without you.',
      'The 3:33 went without you. The bench does not seem to mind.',
    ],
    coast: [
      'Your coat is damp with fog you never walked through.',
      'You can still hear the engine stop. Then nothing at all, for a long time.',
    ],
    home: [
      'You were home. You are sure you were home. The coin in your pocket is still warm.',
      'There was a kitchen with the light left on for you. It is already going, the way dreams go.',
    ],
    nightshift: [
      'Your hands remember the weight of a keyring. Someone else is wearing the cap tonight.',
      'For a while you kept the station. Then somebody fell asleep on the bench, and it was you.',
    ],
    bay0: [
      'You saw a thousand benches through that windscreen. This is only one of them.',
      'Somewhere down a road with no numbers, a door is still open, waiting for you to finish waking.',
    ],
  },
  // One more for each night: by the second night, the first of these.
  memories: [
    'You have done this before. The same stiff neck. The same water stain on the ceiling, shaped like a hand.',
    'You remember why you came. A message on the machine, in your sister\'s voice: "Come home. It\'s time."',
    'Eleven years since you were last home. You bought the ticket that night, before you could talk yourself out of it.',
    'Three coaches to get this far. You kept every stub. There are only two in your pocket.',
    'The coach in from the city was late. You stepped down into this hall, and the clock said 11:47.',
    'You remember the date on your ticket now. It was not 1987. It was not anywhere near 1987.',
    'The PA calls your name, and Claudette says it only calls the ones nobody is expecting. Your sister is expecting you. You are almost sure.',
    'You have started to know their faces better than your own. Marguerite hums when she thinks no one is listening.',
    'Every night the man in the cap looks at you a little longer before he does anything at all.',
  ],
  // Past the end of those, one of these.
  later: [
    'The bench has a dip in it the shape of you now.',
    'You stopped counting the nights. The underside of the bench has not.',
    'Your sister\'s voice on the machine is getting harder to hear. You keep the words anyway: come home.',
  ],
  end: (loop) => loop <= 1
    ? '11:47 PM. The last coach to the coast leaves Bay 9 at 3:33. You will need a valid ticket.'
    : '11:47 PM. Again.',
};
