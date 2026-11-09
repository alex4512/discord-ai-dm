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

/** DM-only notes: world truth across all channels. Never shown to players. */
export const dmNotesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    world_truth: stringList,
    secrets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          secret: { type: 'string' },
          known_by: stringList
        },
        required: ['secret', 'known_by']
      }
    },
    npc_developments: stringList,
    open_threads: stringList,
    continuity_warnings: stringList,
    notes: stringList
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
