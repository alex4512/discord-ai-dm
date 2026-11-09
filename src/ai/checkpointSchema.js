const stringList = { type: 'array', items: { type: 'string' } };

/** Strict JSON schema for the shared campaign checkpoint (all players). */
export const checkpointSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location: { type: 'string' },
    scene: { type: 'string' },
    time: { type: 'string' },

    player_characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          status: { type: 'string' },
          known_facts: stringList
        },
        required: ['name', 'status', 'known_facts']
      }
    },

    party_npcs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          status: { type: 'string' }
        },
        required: ['name', 'status']
      }
    },

    events: stringList,
    objectives: stringList,
    pending_decisions: stringList,
    unresolved_mysteries: stringList,
    inventory_and_resources: stringList,
    notes: stringList
  },

  required: [
    'location',
    'scene',
    'time',
    'player_characters',
    'party_npcs',
    'events',
    'objectives',
    'pending_decisions',
    'unresolved_mysteries',
    'inventory_and_resources',
    'notes'
  ]
};

/** What one character personally knows. Visible to that player only. */
export const characterKnowledgeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    character: { type: 'string' },
    location: { type: 'string' },
    status: { type: 'string' },
    known_facts: stringList,
    secrets_learned: stringList,
    private_events: stringList,
    private_objectives: stringList,
    relationships: stringList,
    inventory_and_resources: stringList,
    notes: stringList
  },
  required: [
    'character',
    'location',
    'status',
    'known_facts',
    'secrets_learned',
    'private_events',
    'private_objectives',
    'relationships',
    'inventory_and_resources',
    'notes'
  ]
};

/** A DM-notes entry tagged with exactly who in play knows it (D-004). */
const taggedList = (field = 'note') => ({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      [field]: { type: 'string' },
      known_by: stringList
    },
    required: [field, 'known_by']
  }
});

/**
 * DM-only notes: world truth across all channels. Every entry carries
 * known_by so it can be filtered per audience in code.
 */
export const dmNotesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    world_truth: taggedList(),
    secrets: taggedList('secret'),
    npc_developments: taggedList(),
    open_threads: taggedList(),
    continuity_warnings: taggedList(),
    notes: taggedList()
  },
  required: [
    'world_truth',
    'secrets',
    'npc_developments',
    'open_threads',
    'continuity_warnings',
    'notes'
  ]
};
