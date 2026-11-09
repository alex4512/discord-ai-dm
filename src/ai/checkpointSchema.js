const stringList = { type: 'array', items: { type: 'string' } };

/** Strict JSON schema for the shared campaign checkpoint. */
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
