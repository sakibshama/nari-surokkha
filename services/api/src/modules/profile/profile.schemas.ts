/**
 * Profile Fastify JSON Schemas
 */

export const getProfileSchema = {
  tags: ['profile'],
  summary: 'Get current user profile',
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
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
            status: { type: 'string' },
            profile: {
              type: 'object',
              nullable: true,
              properties: {
                fullName: { type: 'string' },
                bloodGroup: { type: 'string', nullable: true },
                preferredLanguage: { type: 'string' },
                emergencyNote: { type: 'string', nullable: true },
                nationalId: { type: 'string', nullable: true },
                profilePhotoKey: { type: 'string', nullable: true },
                isVerified: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
};

export const updateProfileSchema = {
  tags: ['profile'],
  summary: 'Update current user profile',
  body: {
    type: 'object',
    properties: {
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      bloodGroup: { type: 'string', maxLength: 5 },
      preferredLanguage: { type: 'string', enum: ['bn', 'en'] },
      emergencyNote: { type: 'string', maxLength: 500 },
      nationalId: { type: 'string', maxLength: 20 },
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
            fullName: { type: 'string' },
            bloodGroup: { type: 'string', nullable: true },
            preferredLanguage: { type: 'string' },
            emergencyNote: { type: 'string', nullable: true },
            nationalId: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
};

export const deactivateAccountSchema = {
  tags: ['profile'],
  summary: 'Deactivate current user account',
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
