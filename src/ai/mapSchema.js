/**
 * Scene sketch for `/map` (D-018): positions as data on a square grid,
 * drawn by code (src/services/mapRender.js), never by an image model.
 * Coordinates are 1-based: x = column (left to right), y = row (top down).
 */
export const FEATURE_KINDS = Object.freeze([
  'wall', 'door', 'water', 'difficult', 'cover', 'tree', 'fire', 'pit', 'stairs', 'other'
]);

export const TOKEN_SIDES = Object.freeze(['party', 'ally', 'enemy', 'neutral']);

export const sceneMapSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    features: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...FEATURE_KINDS] },
          x: { type: 'integer' },
          y: { type: 'integer' },
          w: { type: 'integer' },
          h: { type: 'integer' },
          label: { type: 'string' }
        },
        required: ['kind', 'x', 'y', 'w', 'h', 'label']
      }
    },
    tokens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          side: { type: 'string', enum: [...TOKEN_SIDES] },
          x: { type: 'integer' },
          y: { type: 'integer' }
        },
        required: ['id', 'name', 'side', 'x', 'y']
      }
    },
    notes: { type: 'string' }
  },
  required: ['title', 'width', 'height', 'features', 'tokens', 'notes']
};
