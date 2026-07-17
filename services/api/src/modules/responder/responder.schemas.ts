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

export const updateLocationSchema = {
  type: 'object',
  required: ['latitude', 'longitude'],
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
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
    action: { type: 'string', enum: ['accept', 'reject'] },
    rejectReason: { type: 'string' },
  },
  additionalProperties: false,
};

export const getDispatchesResponseSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
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
