import { Type } from '@sinclair/typebox';

export const caseResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  alertId: Type.String({ format: 'uuid' }),
  stationId: Type.String({ format: 'uuid' }),
  caseNumber: Type.String(),
  status: Type.String(),
  assignedOfficerId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  summary: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  closedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  closedReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  assignedOfficer: Type.Optional(Type.Any()),
  alert: Type.Optional(Type.Any()),
});

export const updateCaseStatusSchema = {
  body: Type.Object({
    status: Type.String({ enum: ['open', 'assigned', 'in_progress', 'resolved', 'closed', 'false_alarm'] }),
    note: Type.Optional(Type.String()),
    closedReason: Type.Optional(Type.String()),
  }),
  response: {
    200: Type.Object({
      message: Type.String(),
      data: caseResponseSchema,
    }),
  },
};

export const assignOfficerSchema = {
  body: Type.Object({
    officerId: Type.String({ format: 'uuid' }),
    note: Type.Optional(Type.String()),
  }),
  response: {
    200: Type.Object({
      message: Type.String(),
      data: caseResponseSchema,
    }),
  },
};

export const addNoteSchema = {
  body: Type.Object({
    note: Type.String(),
  }),
  response: {
    200: Type.Object({
      message: Type.String(),
      data: Type.Any(), // CaseUpdate
    }),
  },
};

export const getCasesSchema = {
  querystring: Type.Object({
    status: Type.Optional(Type.String()),
  }),
  response: {
    200: Type.Object({
      data: Type.Array(caseResponseSchema),
    }),
  },
};

export const getCaseTimelineSchema = {
  response: {
    200: Type.Object({
      data: Type.Object({
        case: caseResponseSchema,
        timeline: Type.Array(Type.Any()),
      }),
    }),
  },
};
