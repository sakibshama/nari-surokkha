export const applyResponderSchema = {
  type: 'object',
  properties: {
    nationalId: { type: 'string' },
    occupation: { type: 'string' },
    organizationName: { type: 'string' },
  },
  additionalProperties: false,
};

export const applyResponderResponseSchema = {
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: { type: 'string' },
    data: {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
      },
    },
  },
};

/** latitude/longitude are required unless availability is 'offline' (checked in the service). */
export const updateLocationSchema = {
  type: 'object',
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    availability: { type: 'string', enum: ['online', 'offline', 'busy'] },
  },
  additionalProperties: false,
};

export const updateLocationResponseSchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
  },
};

export const updateStatusParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
};

export const updateStatusBodySchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['verified', 'rejected', 'pending'] },
  },
  additionalProperties: false,
};

export const updateStatusResponseSchema = {
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: { type: 'string' },
    data: { type: 'object', additionalProperties: true },
  },
};

export const updateAvailabilitySchema = {
  type: 'object',
  required: ['availability'],
  properties: {
    availability: { type: 'string', enum: ['online', 'offline', 'busy'] },
  },
  additionalProperties: false,
};

export const respondDispatchParamsSchema = {
  type: 'object',
  required: ['dispatchId'],
  properties: {
    dispatchId: { type: 'string', format: 'uuid' },
  },
};

export const respondDispatchBodySchema = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['accept', 'reject', 'arrive', 'complete', 'withdraw'] },
    rejectReason: { type: 'string', maxLength: 255 },
  },
  additionalProperties: false,
};

/** One dispatch as the responder app renders it (see toDispatchView). */
export const dispatchViewSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'alertId', 'status', 'alert'],
  properties: {
    id: { type: 'string' },
    alertId: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'accepted', 'arrived', 'completed', 'declined', 'withdrawn', 'closed'] },
    dispatchedAt: { type: 'string', format: 'date-time' },
    acceptedAt: { type: ['string', 'null'], format: 'date-time' },
    arrivedAt: { type: ['string', 'null'], format: 'date-time' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    rejectedAt: { type: ['string', 'null'], format: 'date-time' },
    withdrawnAt: { type: ['string', 'null'], format: 'date-time' },
    closedAt: { type: ['string', 'null'], format: 'date-time' },
    distanceMeters: { type: ['integer', 'null'] },
    alert: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        status: { type: 'string' },
        precise: { type: 'boolean' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        victimName: { type: ['string', 'null'] },
        victimPhone: { type: ['string', 'null'] },
        bloodGroup: { type: ['string', 'null'] },
      },
    },
  },
};

export const respondDispatchResponseSchema = {
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: { type: 'string' },
    data: dispatchViewSchema,
  },
};

export const getDispatchesResponseSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'array',
      items: dispatchViewSchema,
    },
  },
};

export const verifyDispatchParamsSchema = {
  type: 'object',
  required: ['dispatchId'],
  properties: {
    dispatchId: { type: 'string', format: 'uuid' },
  },
};

export const verifyDispatchResponseSchema = {
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: { type: 'string' },
    data: { type: 'object', additionalProperties: true },
  },
};
