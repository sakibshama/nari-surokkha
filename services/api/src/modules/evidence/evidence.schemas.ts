export const evidenceResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    alertId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['photo', 'audio', 'video', 'document'] },
    originalName: { type: 'string' },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'number' },
    checksum: { type: 'string' },
    uploadedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'alertId', 'type', 'originalName', 'mimeType', 'sizeBytes', 'checksum', 'uploadedAt'],
};

export const uploadEvidenceParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Alert ID' },
  }
};

export const uploadEvidenceResponseSchema = {
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: { type: 'string' },
    data: evidenceResponseSchema,
  }
};

export const listEvidenceParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Alert ID' },
  }
};

export const listEvidenceResponseSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'array',
      items: evidenceResponseSchema,
    }
  }
};

export const getEvidenceUrlParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Evidence ID' },
  }
};

export const getEvidenceUrlResponseSchema = {
  type: 'object',
  required: ['url', 'expiresIn'],
  properties: {
    url: { type: 'string' },
    expiresIn: { type: 'number' },
  }
};
