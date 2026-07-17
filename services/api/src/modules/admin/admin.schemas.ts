export const adminListUsersSchema = {
  tags: ['admin'],
  summary: 'List users',
  querystring: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['citizen', 'police', 'admin'] },
      limit: { type: 'number', default: 50 },
      offset: { type: 'number', default: 0 },
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
              phone: { type: 'string' },
              role: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  key: { type: 'string' },
                  name: { type: 'string' },
                }
              },
              isVerified: { type: 'boolean' },
              createdAt: { type: 'string' },
            }
          }
        },
        total: { type: 'number' }
      }
    }
  }
};

export const adminUpdateUserStatusSchema = {
  tags: ['admin'],
  summary: 'Update user status',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['isVerified'], // Using isVerified for ban/unban logic for simplicity
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

export const adminListRespondersSchema = {
  tags: ['admin'],
  summary: 'List responders',
  querystring: {
    type: 'object',
    properties: {
      isVerified: { type: 'boolean' },
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
              userId: { type: 'string' },
              organization: { type: 'string', nullable: true },
              isVerified: { type: 'boolean' },
              status: { type: 'string' },
            }
          }
        }
      }
    }
  }
};

export const adminVerifyResponderSchema = {
  tags: ['admin'],
  summary: 'Verify responder',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
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

export const adminListAuditLogsSchema = {
  tags: ['admin'],
  summary: 'List audit logs',
  querystring: {
    type: 'object',
    properties: {
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
              action: { type: 'string' },
              entityType: { type: 'string' },
              entityId: { type: 'string', nullable: true },
              ipAddress: { type: 'string', nullable: true },
              createdAt: { type: 'string' },
            }
          }
        }
      }
    }
  }
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
          }
        }
      }
    }
  }
};
