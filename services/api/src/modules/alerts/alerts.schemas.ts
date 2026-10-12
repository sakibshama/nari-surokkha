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
  // True when the server could not queue the trusted-contact SMS (Redis down).
  // The app uses it to offer sending the emergency SMS from the phone instead.
  degradedNotifications: { type: 'boolean', nullable: true },
  // The user's SMS quota is used up (or the server could not queue the SMS):
  // the app must text the trusted contacts from the phone's own SIM, using
  // deviceSmsMessage. If it cannot, it calls POST /alerts/:id/sms-fallback.
  smsViaDevice: { type: 'boolean', nullable: true },
  deviceSmsMessage: { type: 'string', nullable: true },
  contactPhones: { type: 'array', items: { type: 'string' }, nullable: true },
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
      // When the fix was actually taken. The mobile client queues pings it
      // could not deliver (poor coverage is the norm in an emergency) and
      // replays them once connectivity returns — without this, a ping taken
      // ten minutes ago would be recorded as the victim's current position.
      timestamp: { type: 'string', format: 'date-time', nullable: true },
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
          // The response serializer drops anything not listed here. Without
          // these two the app never received the tracking link or the contact
          // numbers it needs for the phone-side SMS fallback.
          properties: {
            ...alertProperties,
            trackingToken: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
};

const coordObject = {
  type: 'object',
  required: ['lat', 'lng'],
  additionalProperties: false,
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
  },
};

export const safeRouteSchema = {
  tags: ['alerts'],
  summary: 'Compute a safety-scored walking route from origin to destination',
  body: {
    type: 'object',
    required: ['origin', 'destination'],
    additionalProperties: false,
    properties: {
      origin: coordObject,
      destination: coordObject,
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            origin: coordObject,
            destination: coordObject,
            waypoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  risk: { type: 'number' },
                },
              },
            },
            distanceMeters: { type: 'number' },
            durationSeconds: { type: 'number' },
            safetyScore: { type: 'number' },
            rating: { type: 'string' },
            incidentsNearby: { type: 'number' },
            incidents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  type: { type: 'string' },
                },
              },
            },
            routingEngine: { type: 'string' },
          },
        },
      },
    },
  },
};

export const smsFallbackSchema = {
  tags: ['alerts'],
  summary: 'The phone could not send the SOS SMS from its SIM — send it from the server',
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: { type: 'object', properties: { queued: { type: 'boolean' } } },
      },
    },
  },
};
