/**
 * Auth Fastify JSON Schemas.
 *
 * Used for request/response validation via Fastify's schema system.
 * These schemas also feed the Swagger/OpenAPI docs automatically.
 *
 * Keeps schema definition separate from routes for reusability.
 */

const authUserObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    phone: { type: 'string' },
    role: { type: 'string' },
    fullName: { type: 'string' },
    // The portal gates its UI on these; without them every page showed.
    permissions: { type: 'array', items: { type: 'string' } },
  },
};

const phoneProperty = {
  type: 'string',
  pattern: '^\\+8801[3-9]\\d{8}$',
  description: 'Bangladeshi phone number: +8801XXXXXXXXX',
};

// ─── Phone verification (OTP) ──────────────────────────────────

export const otpRequestSchema = {
  tags: ['auth'],
  summary: 'Send a 6-digit verification code by SMS',
  security: [],
  body: {
    type: 'object',
    required: ['phone'],
    properties: { phone: phoneProperty },
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
            expiresInSec: { type: 'number' },
            // Only in development with the mock SMS provider.
            devCode: { type: 'string' },
          },
        },
      },
    },
  },
};

export const otpVerifySchema = {
  tags: ['auth'],
  summary: 'Exchange the SMS code for a short-lived otpToken used by /auth/register',
  security: [],
  body: {
    type: 'object',
    required: ['phone', 'code'],
    properties: {
      phone: phoneProperty,
      code: { type: 'string', pattern: '^\\d{6}$' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: { type: 'object', properties: { otpToken: { type: 'string' } } },
      },
    },
  },
};

// ─── Register ──────────────────────────────────────────────────

export const registerSchema = {
  tags: ['auth'],
  summary: 'Register a new citizen user',
  security: [],
  body: {
    type: 'object',
    required: ['phone', 'password', 'fullName'],
    properties: {
      phone: {
        type: 'string',
        pattern: '^\\+8801[3-9]\\d{8}$',
        description: 'Bangladeshi phone number: +8801XXXXXXXXX',
      },
      password: {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        description: 'Min 8 chars, must contain uppercase and number',
      },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      preferredLanguage: { type: 'string', enum: ['bn', 'en'], default: 'bn' },
      // From /auth/otp/verify. Required when PHONE_VERIFICATION=required.
      otpToken: { type: 'string', minLength: 1, maxLength: 2048 },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            user: authUserObject,
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

// ─── Login ─────────────────────────────────────────────────────

export const loginSchema = {
  tags: ['auth'],
  summary: 'Login with phone and password',
  security: [],
  body: {
    type: 'object',
    required: ['phone', 'password'],
    properties: {
      phone: {
        type: 'string',
        minLength: 3,
        maxLength: 20,
        description: 'Phone number (e.g. +8801XXXXXXXXX)',
      },
      password: { type: 'string', minLength: 1, maxLength: 128 },
      deviceToken: { type: 'string', maxLength: 512 },
      platform: { type: 'string', enum: ['android', 'ios'] },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            user: authUserObject,
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

// ─── Refresh Token ─────────────────────────────────────────────

export const refreshSchema = {
  tags: ['auth'],
  summary: 'Refresh access token using refresh token',
  security: [],
  body: {
    type: 'object',
    properties: {
      refreshToken: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'number' },
            user: authUserObject,
          },
        },
      },
    },
  },
};

// ─── Logout ────────────────────────────────────────────────────

export const logoutSchema = {
  tags: ['auth'],
  summary: 'Logout current session',
  body: {
    type: 'object',
    properties: {
      refreshToken: { type: 'string', minLength: 1 },
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

// ─── Register Device Token ─────────────────────────────────────

export const deviceTokenSchema = {
  tags: ['auth'],
  summary: 'Register or update FCM device token',
  body: {
    type: 'object',
    required: ['token', 'platform'],
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 512 },
      platform: { type: 'string', enum: ['android', 'ios'] },
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

// ─── Logout All ────────────────────────────────────────────────

export const logoutAllSchema = {
  tags: ['auth'],
  summary: 'Logout from all devices',
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

// ─── Change Password ───────────────────────────────────────────

export const changePasswordSchema = {
  tags: ['auth'],
  summary: 'Change current user password',
  body: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', minLength: 1 },
      newPassword: { type: 'string', minLength: 6, maxLength: 128 },
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

export const deleteDeviceTokenSchema = {
  tags: ['auth'],
  summary: 'Stop push notifications to a device token',
  body: {
    type: 'object',
    required: ['token'],
    properties: { token: { type: 'string', minLength: 1, maxLength: 512 } },
    additionalProperties: false,
  },
  response: {
    200: { type: 'object', properties: { success: { type: 'boolean' } } },
  },
};
