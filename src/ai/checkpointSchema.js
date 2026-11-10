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
    // D-006: perceivable physical state, never who caused it. Not tagged:
    // visible to every channel after a name check in code.
    observable_world_state: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          location: { type: 'string' },
          state: { type: 'string' }
        },
        required: ['location', 'state']
      }
    },
    world_truth: taggedList(),
    secrets: taggedList('secret'),
    npc_developments: taggedList(),
    open_threads: taggedList(),
    continuity_warnings: taggedList(),
    notes: taggedList()
  },
  required: [
    'observable_world_state',
    'world_truth',
    'secrets',
    'npc_developments',
    'open_threads',
    'continuity_warnings',
    'notes'
  ]
};

const taggedValue = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: 'string' },
    known_by: stringList
  },
  required: ['value', 'known_by']
};

const npcItem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    role: { type: 'string' },
    appearance: { type: 'string' },
    personality: { type: 'string' },
    status: taggedValue,
    location: taggedValue,
    facts: taggedList('fact'),
    // D-016: what the NPC personally remembers about each character.
    memories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          with: { type: 'string' },
          memory: { type: 'string' },
          secret: { type: 'boolean' }
        },
        required: ['with', 'memory', 'secret']
      }
    }
  },
  required: ['name', 'role', 'appearance', 'personality', 'status', 'location', 'facts', 'memories']
};

const locationItem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    state: taggedValue,
    facts: taggedList('fact')
  },
  required: ['name', 'description', 'state', 'facts']
};

const eventItem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    event: { type: 'string' },
    location: { type: 'string' },
    known_by: stringList
  },
  required: ['event', 'location', 'known_by']
};

/**
 * World update at each save (D-007, D-009): the NPC and location entries
 * that are new or changed (D-026; omitted entries are kept by mergeUpdate)
 * plus the NEW events since the last checkpoint. author_notes
 * are deliberately NOT part of this schema: only the DM writes them.
 */
export const worldUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    npcs: { type: 'array', items: npcItem },
    locations: { type: 'array', items: locationItem },
    events: { type: 'array', items: eventItem }
  },
  required: ['npcs', 'locations', 'events']
};
