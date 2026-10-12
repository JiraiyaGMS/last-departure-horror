// All the writing lives here: the fourteen passengers (five of whom you can
// actually reach in this build), the paper you find, and what the PA says.

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
    name: 'Marguerite Vance',
    item: 'A hatbox, crushed on one side',
    itemId: 'hatbox',
    where: { room: 'hall', x: -6, z: 5, yaw: 0.4 },
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
    where: { room: 'ticket', x: -14, z: -7, yaw: 1.6 },
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
    where: { room: 'diner', x: 15, z: 7, yaw: -2.4 },
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
];

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
    lines: (loop) => [
      'BUS, 14 PASSENGERS MISSING ON COAST ROUTE',
      'November 5, 1987 — State police have found no trace of the 11:47 service',
      'from Grayhollow Transit Center, which departed Bay 9 on Tuesday night.',
      '',
      loop <= 1
        ? '[The photograph shows an empty loading platform.]'
        : loop === 2
        ? '[In the photograph, a figure in a transit cap stands at the edge of Bay 9.]'
        : loop === 3
        ? '[In the photograph, the figure has turned to face the camera.]'
        : '[In the photograph, someone is sitting on the bench. They are wearing your clothes.]',
    ],
  },
  postcards: {
    title: 'Postcards, Never Sent',
    lines: () => [
      'To D. Krenshaw — "The belts can run without you for one week. Come down."',
      'To M. Vance — "Saved you a slot on Friday. Bring the good dress."',
      'To Sister I. Ruiz — "The children ask about you. Travel safe."',
      'To T. Penn — "Your uncle wrote that you are coming alone. Be brave."',
      'To N. Abbot — "Your photographs came out. All but the last roll."',
      '',
      'None of them have stamps.',
    ],
  },
  pascript: {
    title: 'PA Announcement Scripts',
    lines: (loop, playerName = 'PASSENGER') => [
      'SCRIPT 1 — "The 11:47 service to the coast is now boarding at Bay 9."',
      'SCRIPT 4 — "Passengers are reminded not to leave baggage unattended."',
      'SCRIPT 9 — "Would ' + playerName + ' please come to the ticket office."',
      'SCRIPT 9 is typed on the same page as the others.',
      'The ink is not faded. It was typed tonight.',
      '',
      'SCRIPT 12 — "Do not answer to your name. — W.P."',
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
      'Taped inside the stall door, in pencil:',
      '',
      'TWO OF THE RULES ON THE WALL ARE NOT OURS.',
      'ONE WANTS YOU BLIND. ONE WANTS YOU LIT UP.',
      '',
      'READ THE WALL IN THE GLASS AFTER TWO.',
      '',
      '— I.R.',
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
  ],
  // The lure: answering is a rule break.
  nameCall: [
    'Would the passenger on bench four please come to the ticket office.',
    'Paging the passenger who has not bought a ticket. Please identify yourself.',
    'Would the owner of a hatbox please report to Bay 9 immediately.',
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
