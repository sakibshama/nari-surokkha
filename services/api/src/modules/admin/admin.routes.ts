import { FastifyInstance } from 'fastify';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';
import { requireRoles, requirePermissions } from '@/middleware/rbac';
import type { CreateUserInput, UpdateUserInput, ListAlertsQuery } from './admin.service';
import type { AdminSettableStatus } from '@/modules/alerts/alert-status';

type IdParams = { id: string };
type ListUsersRoute = { Querystring: { role?: string; search?: string; limit?: number; offset?: number } };
import {
  adminListUsersSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  adminDeleteUserSchema,
  adminUpdateUserStatusSchema,
  adminVerifyResponderSchema,
  adminAlertStatusSchema,
  adminListAlertsSchema,
  adminAlertDetailSchema,
  adminHealthSchema,
} from './admin.schemas';

export function adminRoutes(
  fastify: FastifyInstance,
  _options: unknown,
  done: () => void,
) {
  // Reporting-shaped reads go to the replica when one is configured.
  const repository = new AdminRepository(fastify.prisma, fastify.prismaRead, fastify.log);
  const service = new AdminService(repository, fastify);
  const controller = new AdminController(service);

  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', requireRoles(['admin'])); // Strictly Admin only

  const manageUsers = { preHandler: [requirePermissions(['manage_users'])] };

  // Users
  fastify.get<ListUsersRoute>('/users', { ...manageUsers, schema: adminListUsersSchema }, controller.listUsers);
  fastify.post<{ Body: CreateUserInput }>('/users', { ...manageUsers, schema: adminCreateUserSchema }, controller.createUser);
  fastify.put<{ Params: IdParams; Body: UpdateUserInput }>('/users/:id', { ...manageUsers, schema: adminUpdateUserSchema }, controller.updateUser);
  fastify.delete<{ Params: IdParams }>('/users/:id', { ...manageUsers, schema: adminDeleteUserSchema }, controller.deleteUser);
  fastify.patch<{ Params: IdParams; Body: { isVerified: boolean } }>('/users/:id/status', { ...manageUsers, schema: adminUpdateUserStatusSchema }, controller.updateUserStatus);

  // Responders
  fastify.get('/responders', manageUsers, controller.listResponders as any);
  fastify.patch<{ Params: IdParams; Body: { isVerified: boolean } }>('/responders/:id/verify', { ...manageUsers, schema: adminVerifyResponderSchema }, controller.verifyResponder);
  fastify.delete('/responders/:id', manageUsers, controller.deleteResponder as any);

  // Audit Logs
  fastify.get('/audit-logs', { preHandler: [requirePermissions(['view_audit_logs'])] }, controller.listAuditLogs as any);
  
  // Health
  fastify.get('/health', { schema: adminHealthSchema }, controller.getHealth);

  // Alerts
  // SOS reports: every alert, whatever its status, with its status history.
  fastify.get<{ Querystring: ListAlertsQuery }>('/alerts', { schema: adminListAlertsSchema }, controller.listAlerts);
  fastify.get<{ Params: IdParams }>('/alerts/:id', { schema: adminAlertDetailSchema }, controller.getAlertById);
  fastify.patch<{ Params: IdParams; Body: { status: AdminSettableStatus; note?: string } }>(
    '/alerts/:id/status',
    { schema: adminAlertStatusSchema },
    controller.setAlertStatus,
  );

  // Incidents
  fastify.get('/incidents', controller.listIncidents as any);
  fastify.patch('/incidents/:id/status', controller.updateIncidentStatus as any);
  
  // Analytics
  fastify.get('/analytics', controller.getAnalytics);

  done();
}
