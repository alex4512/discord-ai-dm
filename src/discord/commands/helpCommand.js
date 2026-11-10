import { reply } from '../reply.js';
import { audienceForChannel } from '../../services/audience.js';

// `/help` (English) and `/help gr` (Greek): the player commands that work in
// this channel. Keep this list next to the commands: add a line when a
// player-visible command ships. Audiences: shared (#main-adventure),
// character (a private channel), dm (#dm-testing).
const ALL = ['shared', 'character', 'dm'];

const HELP = [
  { where: ALL, en: '**Play:** mention the DM and say or do anything in your own words. Start with (OOC) to talk to the DM outside the story. Commands also start with @Dungeon Master.',
    gr: '**Παιχνίδι:** κάνε mention τον DM και πες ή κάνε ό,τι θέλεις, με δικά σου λόγια. Ξεκίνα με (OOC) για να μιλήσεις στον DM εκτός ιστορίας. Και οι εντολές ξεκινούν με @Dungeon Master.' },

  { section: { en: 'Story', gr: 'Ιστορία' } },
  { where: ['shared'], cmd: '/checkpoint save', en: 'save the story so far (play goes on)', gr: 'αποθήκευση της ιστορίας (το παιχνίδι συνεχίζεται)' },
  { where: ['shared'], cmd: '/checkpoint undo', en: 'undo the last save, all play kept', gr: 'αναίρεση της τελευταίας αποθήκευσης, το παιχνίδι μένει' },
  { where: ['shared'], cmd: '/checkpoint rollback <n>', en: 'go back to save n (later play is dropped)', gr: 'επιστροφή στην αποθήκευση n (ό,τι έγινε μετά χάνεται)' },
  { where: ['shared', 'dm'], cmd: '/checkpoint versions', en: 'list the saves', gr: 'λίστα αποθηκεύσεων' },
  { where: ['character'], en: 'Saving, undo and rollback are done in #main-adventure.', gr: 'Αποθήκευση, αναίρεση και επιστροφή γίνονται στο #main-adventure.' },
  { where: ALL, cmd: '/checkpoint show', en: 'the saved story, as this channel may see it', gr: 'η αποθηκευμένη ιστορία, όσο επιτρέπεται εδώ' },
  { where: ALL, cmd: '/chronicle', en: 'recent events (/chronicle all: every event from the beginning; /chronicle chapters: the summarized older chapters)', gr: 'πρόσφατα γεγονότα (/chronicle all: όλα από την αρχή· /chronicle chapters: τα παλιότερα σε κεφάλαια)' },
  { where: ['shared'], cmd: '/story [gr]', en: 'your character tells the group the whole story so far; everyone knows it from then on', gr: 'ο χαρακτήρας σου λέει στην ομάδα όλη την ιστορία ως τώρα· από εκεί και πέρα την ξέρουν όλοι' },
  { where: ['character'], cmd: '/story [gr]', en: 'your whole story so far, private to you', gr: 'όλη η ιστορία σου ως τώρα, μόνο για σένα' },
  { where: ['dm'], cmd: '/story [gr] [character]', en: "the party's shared story, or one character's", gr: 'η κοινή ιστορία της ομάδας, ή ενός χαρακτήρα' },

  { section: { en: 'Character and party', gr: 'Χαρακτήρας και ομάδα' } },
  { where: ALL, cmd: '/xp', en: 'XP and level, in your private channel (/xp help: award by hand if the DM forgot)', gr: 'XP και επίπεδο, στο ιδιωτικό σου κανάλι (/xp help: απονομή με το χέρι αν ο DM το ξέχασε)' },
  { where: ALL, cmd: '/inventory', en: "the party's items; your own too in your private channel", gr: 'τα αντικείμενα της ομάδας· και τα δικά σου στο ιδιωτικό σου κανάλι' },

  { section: { en: 'World', gr: 'Κόσμος' } },
  { where: ALL, cmd: '/npc list', en: 'people you know (/npc show <name> for one)', gr: 'πρόσωπα που ξέρετε (/npc show <όνομα> για ένα)' },
  { where: ALL, cmd: '/location list', en: 'places you know (/location show <name> for one)', gr: 'μέρη που ξέρετε (/location show <όνομα> για ένα)' },
  { where: ALL, cmd: '/map', en: 'a top-down sketch of the scene (/map text for a text grid)', gr: 'σκίτσο της σκηνής από ψηλά (/map text για πλέγμα σε κείμενο)' },
  { where: ALL, cmd: '/image [what]', cmdGr: '/image [τι]', en: 'a picture of the scene (limited per day)', gr: 'εικόνα της σκηνής (όριο ανά ημέρα)' },

  { section: { en: 'DM tools (#dm-testing)', gr: 'Εργαλεία DM (#dm-testing)' }, where: ['dm'] },
  { where: ['dm'], cmd: '/npc note <name>: <text>', en: 'add DM truth to an NPC (/location note the same)', gr: 'αλήθεια του DM για έναν NPC (το ίδιο /location note)' },
  { where: ['dm'], cmd: '/xp set <character> <total>', en: 'set XP (/xp help: award by hand)', gr: 'ορισμός XP (/xp help: απονομή με το χέρι)' },
  { where: ['dm'], cmd: '/inventory <changes>', en: 'correct the inventory (/inventory help)', gr: 'διόρθωση αντικειμένων (/inventory help)' },
  { where: ['dm'], cmd: '/chronicle compact', en: 'summarize old events into chapters now (otherwise automatic at save past 250)', gr: 'σύνοψη παλιών γεγονότων σε κεφάλαια τώρα (αλλιώς αυτόματα στο save πάνω από 250)' }
];

const FOOTER = {
  en: 'Questions about rules or the story: ask the DM with (OOC). `/help gr`: στα ελληνικά.',
  gr: 'Ερωτήσεις για κανόνες ή την ιστορία: ρώτα τον DM με (OOC). `/help`: in English.'
};

/** The help text for one audience kind ('shared' | 'character' | 'dm') and language. */
export function helpText(kind, lang = 'en') {
  const lines = [];
  let pendingSection = null;
  for (const entry of HELP) {
    if (entry.section) {
      pendingSection = (!entry.where || entry.where.includes(kind)) ? entry.section[lang] : null;
      continue;
    }
    if (!entry.where.includes(kind)) continue;
    if (pendingSection) {
      lines.push('', `__${pendingSection}__`);
      pendingSection = null;
    }
    const cmd = lang === 'gr' && entry.cmdGr ? entry.cmdGr : entry.cmd;
    lines.push(cmd ? `\`${cmd}\`: ${entry[lang]}` : entry[lang]);
  }
  lines.push('', FOOTER[lang]);
  return lines.join('\n');
}

const GREEK = /^(gr|el|greek|ελληνικά|ελληνικα)$/i;

export const helpCommand = {
  parse(prompt) {
    const match = prompt.trim().match(/^\/(?:help|βοήθεια|βοηθεια)(?:\s+(\S+))?\s*$/i);
    if (!match) return null;
    const greek = /^\/β/i.test(prompt.trim()) || GREEK.test(match[1] || '');
    return greek ? 'gr' : 'en';
  },

  async handle(message, lang, ctx) {
    const { kind } = audienceForChannel(ctx.channelId, ctx.player);
    return reply(message, helpText(kind, lang));
  }
};
