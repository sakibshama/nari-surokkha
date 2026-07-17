export const submitIncidentSchema = {
  tags: ['incidents'],
  summary: 'Submit an anonymous incident report',
  body: {
    type: 'object',
    required: ['type', 'latitude', 'longitude'],
    properties: {
      type: { type: 'string', enum: ['harassment', 'robbery', 'suspicious_activity', 'poor_lighting', 'other'] },
      description: { type: 'string', nullable: true },
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
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
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  },
};

export const adminListIncidentsSchema = {
  tags: ['incidents'],
  summary: 'List incidents for admin verification',
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'verified', 'rejected'] },
      limit: { type: 'number', default: 50 },
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              description: { type: 'string', nullable: true },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              status: { type: 'string' },
              createdAt: { type: 'string' },
            }
          }
        }
      }
    }
  }
};

export const adminUpdateIncidentStatusSchema = {
  tags: ['incidents'],
  summary: 'Verify or reject an incident report',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['verified', 'rejected'] },
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

export const getSafetyScoreSchema = {
  tags: ['incidents'],
  summary: 'Get safety score for a location',
  querystring: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            factors: {
              type: 'object',
              additionalProperties: true
            }
          }
        }
      }
    }
  }
};
