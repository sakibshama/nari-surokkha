/**
 * Admin route schemas.
 *
 * The user response schemas are a second line of defence for the password
 * hash: the repository already selects explicit columns, and the serializer
 * drops anything not listed here.
 */

const uuidParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};

const permissionList = {
  type: 'array',
  items: { type: 'string', minLength: 1, maxLength: 64 },
  uniqueItems: true,
  maxItems: 50,
};

/** A user as the admin portal sees it. Never includes passwordHash. */
const adminUserObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string', nullable: true },
    status: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    roleId: { type: 'string' },
    role: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        key: { type: 'string' },
        name: { type: 'string' },
      },
    },
    profile: {
      type: 'object',
      nullable: true,
      properties: {
        fullName: { type: 'string' },
        nationalId: { type: 'string', nullable: true },
        bloodGroup: { type: 'string', nullable: true },
        preferredLanguage: { type: 'string' },
        isVerified: { type: 'boolean' },
        verifiedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const userResponse = {
  200: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: adminUserObject,
    },
  },
};

export const adminListUsersSchema = {
  tags: ['admin'],
  summary: 'List users',
  querystring: {
    type: 'object',
    properties: {
      role: { type: 'string', maxLength: 50 },
      search: { type: 'string', maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'array', items: adminUserObject },
        total: { type: 'number' },
      },
    },
  },
};

const userFields = {
  phone: { type: 'string', minLength: 3, maxLength: 20 },
  email: { type: 'string', maxLength: 255, anyOf: [{ format: 'email' }, { maxLength: 0 }] },
  fullName: { type: 'string', minLength: 1, maxLength: 100 },
  nationalId: { type: 'string', maxLength: 20 },
  role: { type: 'string', minLength: 1, maxLength: 50 },
  permissions: permissionList,
  password: { type: 'string', minLength: 8, maxLength: 128 },
  isVerified: { type: 'boolean' },
};

export const adminCreateUserSchema = {
  tags: ['admin'],
  summary: 'Create a user',
  body: {
    type: 'object',
    required: ['phone', 'fullName', 'password'],
    properties: userFields,
    additionalProperties: false,
  },
  response: userResponse,
};

export const adminUpdateUserSchema = {
  tags: ['admin'],
  summary: 'Update a user (only the fields present are changed)',
  params: uuidParams,
  body: {
    type: 'object',
    properties: {
      ...userFields,
      status: { type: 'string', enum: ['active', 'inactive', 'suspended', 'pending_verification'] },
    },
    additionalProperties: false,
  },
  response: userResponse,
};

export const adminDeleteUserSchema = {
  tags: ['admin'],
  summary: 'Delete a user (deactivates instead when they have history)',
  params: uuidParams,
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: { result: { type: 'string', enum: ['deleted', 'deactivated'] } },
        },
      },
    },
  },
};

export const adminUpdateUserStatusSchema = {
  tags: ['admin'],
  summary: 'Set or clear a user\'s verified flag',
  params: uuidParams,
  body: {
    type: 'object',
    required: ['isVerified'],
    properties: {
      isVerified: { type: 'boolean' },
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

export const adminVerifyResponderSchema = {
  tags: ['admin'],
  summary: 'Verify responder',
  params: uuidParams,
  body: {
    type: 'object',
    required: ['isVerified'],
    properties: {
      isVerified: { type: 'boolean' },
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

export const adminAlertStatusSchema = {
  tags: ['admin'],
  summary: 'Set an alert\'s status (in progress, resolved, closed, false alarm)',
  params: uuidParams,
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['in_progress', 'resolved', 'closed', 'false_alarm'] },
      note: { type: 'string', maxLength: 1000 },
    },
    additionalProperties: false,
  },
};

export const adminHealthSchema = {
  tags: ['admin'],
  summary: 'System health summary',
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            totalUsers: { type: 'number' },
            activeAlerts: { type: 'number' },
            verifiedResponders: { type: 'number' },
            pendingResponders: { type: 'number' },
          },
        },
      },
    },
  },
};
