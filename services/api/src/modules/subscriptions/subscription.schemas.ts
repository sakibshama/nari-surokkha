export const initPaymentSchema = {
  body: {
    type: 'object',
    required: ['planId'],
    additionalProperties: false,
    properties: {
      planId: { type: 'string', maxLength: 40 },
      // Optional for older app builds (first gateway that sells the plan is used).
      gatewayId: { type: 'string', maxLength: 60 },
    },
  },
};

export const getSubscriptionStatusSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          nullable: true,
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            planId: { type: 'string' },
            planName: { type: 'string' },
            planNameBn: { type: 'string' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            smsRemaining: { type: 'number' },
          },
        },
      },
    },
  },
};

export const paymentStatusSchema = {
  params: {
    type: 'object',
    required: ['transactionId'],
    properties: { transactionId: { type: 'string', maxLength: 100 } },
  },
};
