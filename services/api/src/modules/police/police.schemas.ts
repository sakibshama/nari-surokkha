/**
 * Police Module Schemas
 */

export const policeLoginSchema = {
  tags: ['police'],
  summary: 'Police Officer Login',
  body: {
    type: 'object',
    required: ['identifier', 'password'],
    properties: {
      identifier: { type: 'string', minLength: 3 },
      password: { type: 'string', minLength: 6 },
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
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                badgeNumber: { type: 'string' },
                role: { type: 'string' },
                stationId: { type: 'string', format: 'uuid' },
                stationName: { type: 'string' },
              },
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
                expiresIn: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
};

export const updateAlertStatusSchema = {
  tags: ['police'],
  summary: 'Update alert status (e.g., acknowledge)',
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
      status: { 
        type: 'string', 
        enum: ['in_progress', 'resolved', 'false_alarm'] 
      },
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
          additionalProperties: true,
        },
      },
    },
  },
};

export const getActiveAlertsSchema = {
  tags: ['police'],
  summary: 'Get active alerts for a police station',
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
  },
};

export const getAlertByIdSchema = {
  tags: ['police'],
  summary: 'Get a specific alert by ID',
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
        data: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  },
};

export const getPoliceProfileSchema = {
  tags: ['police'],
  summary: 'Get police user profile',
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            badgeNumber: { type: 'string' },
            fullName: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', nullable: true },
            role: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                key: { type: 'string' },
                name: { type: 'string' },
              }
            },
          },
        },
      },
    },
  },
};

export const updatePoliceProfileSchema = {
  tags: ['police'],
  summary: 'Update police user profile',
  body: {
    type: 'object',
    properties: {
      phone: { type: 'string', minLength: 10 },
      email: { type: 'string', format: 'email' },
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
          additionalProperties: true,
        },
      },
    },
  },
};

export const changePolicePasswordSchema = {
  tags: ['police'],
  summary: 'Change police user password',
  body: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', minLength: 1 },
      newPassword: { type: 'string', minLength: 6 },
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
