import { config } from '../config.js';

/**
 * Who can read a channel (docs/DECISIONS.md, D-002):
 *   #dm-testing      -> dm         (the DM's debug channel: everything)
 *   private channel  -> character  (shared world + own knowledge)
 *   anything else    -> shared     (shared world only)
 *
 * Private channels are owner-only (enforced in access.js), so the author
 * of a message there is the channel's character.
 */
export function audienceForChannel(channelId, player) {
  if (channelId === config.channels.test) {
    return { kind: 'dm' };
  }

  if (config.privateChannels.some(c => c.channelId === channelId)) {
    return { kind: 'character', name: player.character_name };
  }

  return { kind: 'shared' };
}

const json = value => JSON.stringify(value, null, 2);
const section = (title, body) => `**${title}**\n${body}`;
const NOTHING_YET = '(nothing recorded yet)';

/** Renders a { checkpoint, character_knowledge, dm_notes } snapshot. */
export function renderSnapshot(snapshot, audience) {
  const knowledge = snapshot.character_knowledge || {};
  const sections = [section('Shared world', json(snapshot.checkpoint))];

  if (audience.kind === 'character') {
    const own = knowledge[audience.name];
    sections.push(section(
      `${audience.name}: private knowledge`,
      own ? json(own) : NOTHING_YET
    ));
  } else if (audience.kind === 'dm') {
    for (const [name, entry] of Object.entries(knowledge)) {
      sections.push(section(`${name}: private knowledge`, json(entry)));
    }
    sections.push(section(
      'DM notes',
      snapshot.dm_notes ? json(snapshot.dm_notes) : NOTHING_YET
    ));
  } else {
    sections.push(
      '_Private character knowledge and DM notes are not shown in this channel._'
    );
  }

  return sections.join('\n\n');
}
