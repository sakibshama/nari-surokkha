import { FastifySchema } from 'fastify';

export const createRoleSchema: FastifySchema = {
  description: 'Create a new dynamic role',
  tags: ['Roles'],
  body: {
    type: 'object',
    required: ['name', 'key'],
    properties: {
      name: { type: 'string' },
      key: { type: 'string' },
      description: { type: 'string' },
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            key: { type: 'string' },
            description: { type: 'string' },
            isSystem: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          }
        }
      }
    }
  }
};

export const updateRoleSchema: FastifySchema = {
  description: 'Update a role',
  tags: ['Roles'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } }
  },
  body: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
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
            id: { type: 'string' },
            name: { type: 'string' },
            key: { type: 'string' },
            description: { type: 'string' },
            isSystem: { type: 'boolean' },
          }
        }
      }
    }
  }
};

export const listRolesSchema: FastifySchema = {
  description: 'List all roles',
  tags: ['Roles'],
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
              name: { type: 'string' },
              key: { type: 'string' },
              description: { type: 'string', nullable: true },
              isSystem: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  }
};

export const deleteRoleSchema: FastifySchema = {
  description: 'Delete a role',
  tags: ['Roles'],
  params: {
    type: 'object',
    properties: { id: { type: 'string' } }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  }
};
