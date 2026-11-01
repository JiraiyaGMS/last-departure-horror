// Português (Brasil).
//
// Everything the game says, keyed by the English it says it in (see
// src/i18n.js). `node tools/i18n/check.mjs` lists anything missing.
//
// Glossary, so the same thing is always called the same:
//   bay ................ plataforma (on a sign: PLAT.)
//   the coast .......... o litoral
//   the Attendant ...... o Atendente; night attendant: atendente noturno
//   ticket ............. passagem; stub: canhoto; stamp: carimbo
//   transfer (slip) .... (bilhete de) transferência; punched: picotado
//   conductor's punch .. picotador do cobrador
//   keyring ............ molho de chaves
//   PA ................. alto-falante; PA console: console de avisos
//   hall ............... saguão; station: rodoviária
//   Lost & Found ....... Achados e Perdidos
//   Baggage Claim ...... Retirada de Bagagem
//   Ticket Office ...... Bilheteria
//   locker ............. armário; flashlight/torch: lanterna; cell: pilha
//   notebook ........... caderno; loop (a night): noite
//   "the 11:47" ........ "o das 11:47"
// The clock keeps AM and PM where the station shows a time (it is an
// American station in 1987); prose says "da manhã" and "da noite".
//
// The player is "você" and is never given a gender: no adjective or
// participle that agrees with them (not "escondido", but "fora de vista").
// The passengers speak as who they are.

import interfaceWords from './interface.js';
import world from './world.js';
import story from './story.js';

export default { ...story, ...world, ...interfaceWords };

// Keys the game only ever passes to t() as a variable: the departure board's
// statuses and the places on it.
export const RUNTIME_KEYS = [
  'CANCELLED', 'DELAYED', 'DEPARTED', 'BOARDING', 'WAITING', '3:33 AM',
  'GLOVERSVILLE', 'ASHTON FORK', 'REDHILL', 'PINE JUNCTION', 'WEST MERROW', 'YARROW BEND',
];

// Notebook entries with a name, a word or a number in them. They are saved
// in English (see i18n.js), so they are matched here and said again.
export const PT_PATTERNS = [
  [/^Loop (\d+): the thing was on camera (\d+)\. Each loop it is one camera closer\.$/,
    (m) => `Noite ${m[1]}: a coisa estava na câmera ${m[2]}. A cada noite, ela fica uma câmera mais perto.`],
  [/^The cancelled destinations spell (\S+)\. That is the locker word\.$/,
    (m) => `Os destinos cancelados formam ${m[1]}. É a palavra do armário.`],
  [/^Locker 9 opens to (\S+)\.$/,
    (m) => `O Armário 9 abre com ${m[1]}.`],
  [/^REAL RULE: (.+)$/,
    (m, { t }) => `REGRA VERDADEIRA: ${t(m[1])}`],
  [/^(Tap|Press) (.+) to put a fresh cell in the torch\.$/,
    // A touch button's name is a word; a key's (B, RB) is not.
    (m, { t }) => (m[1] === 'Tap'
      ? `Toque em ${t(m[2])} para colocar uma pilha nova na lanterna.`
      : `Aperte ${m[2]} para colocar uma pilha nova na lanterna.`)],
  [/^(.+) is waiting for (.+)\.$/,
    (m, { t, tLoose }) => `${t(m[1])} está esperando ${tLoose(m[2])}.`],
  [/^(.+) belongs to (.+)\.$/,
    (m, { t }) => {
      const item = t(m[1]);
      return `${item}${item.includes(',') ? ',' : ''} pertence a ${t(m[2])}.`;
    }],
];
