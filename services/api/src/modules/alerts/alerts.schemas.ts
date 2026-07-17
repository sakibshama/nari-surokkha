/**
 * Alerts Fastify JSON Schemas
 */

const alertProperties = {
  id: { type: 'string', format: 'uuid' },
  userId: { type: 'string', format: 'uuid' },
  type: { type: 'string', enum: ['manual', 'sensor_triggered', 'ml_triggered'] },
  status: { type: 'string' },
  latitude: { type: 'number' },
  longitude: { type: 'number' },
  accuracy: { type: 'number', nullable: true },
  assignedStationId: { type: 'string', format: 'uuid', nullable: true },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

export const createSosSchema = {
  tags: ['alerts'],
  summary: 'Trigger a manual SOS alert',
  body: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      accuracy: { type: 'number', nullable: true },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: alertProperties,
        },
      },
    },
  },
};

export const updateLocationSchema = {
  tags: ['alerts'],
  summary: 'Update live location for an active SOS alert',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      accuracy: { type: 'number', nullable: true },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
};

export const generateTrackingTokenSchema = {
  tags: ['alerts'],
  summary: 'Generate a tracking token for an active SOS alert',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    properties: {
      trustedContactId: { type: 'string', format: 'uuid', nullable: true },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
};

export const createSoftAlertSchema = {
  tags: ['alerts'],
  summary: 'Trigger a sensor-based soft alert',
  body: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      accuracy: { type: 'number', nullable: true },
      mlMetadata: { type: 'object', additionalProperties: true, nullable: true },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: alertProperties,
        },
      },
    },
  },
};

export const cancelSoftAlertSchema = {
  tags: ['alerts'],
  summary: 'Cancel a sensor-based soft alert',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
};

export const cancelSosAlertSchema = {
  tags: ['alerts'],
  summary: 'Cancel an active SOS alert',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
};

export const confirmSoftAlertSchema = {
  tags: ['alerts'],
  summary: 'Confirm a soft alert, triggering SOS dispatch',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: alertProperties,
        },
      },
    },
  },
};
