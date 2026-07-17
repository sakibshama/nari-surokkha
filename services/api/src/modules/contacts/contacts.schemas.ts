/**
 * Contacts Fastify JSON Schemas
 */

const contactProperties = {
  id: { type: 'string' },
  userId: { type: 'string' },
  name: { type: 'string' },
  phone: { type: 'string' },
  relation: { type: 'string', nullable: true },
  isPrimary: { type: 'boolean' },
  isVerified: { type: 'boolean' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

export const getContactsSchema = {
  tags: ['contacts'],
  summary: 'Get all trusted contacts for current user',
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: contactProperties,
          },
        },
      },
    },
  },
};

export const createContactSchema = {
  tags: ['contacts'],
  summary: 'Add a new trusted contact',
  body: {
    type: 'object',
    required: ['name', 'phone'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      phone: {
        type: 'string',
        pattern: '^\\+8801[3-9]\\d{8}$',
        description: 'Bangladeshi phone number: +8801XXXXXXXXX',
      },
      relation: { type: 'string', maxLength: 50 },
      isPrimary: { type: 'boolean', default: false },
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
          properties: contactProperties,
        },
      },
    },
  },
};

export const updateContactSchema = {
  tags: ['contacts'],
  summary: 'Update an existing trusted contact',
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
      name: { type: 'string', minLength: 2, maxLength: 100 },
      phone: {
        type: 'string',
        pattern: '^\\+8801[3-9]\\d{8}$',
      },
      relation: { type: 'string', maxLength: 50 },
      isPrimary: { type: 'boolean' },
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
          properties: contactProperties,
        },
      },
    },
  },
};

export const deleteContactSchema = {
  tags: ['contacts'],
  summary: 'Delete a trusted contact',
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

export const verifyContactSchema = {
  tags: ['contacts'],
  summary: 'Verify a trusted contact',
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
          properties: contactProperties,
        },
      },
    },
  },
};
