import { FastifyInstance } from 'fastify';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';
import { requireRoles, requirePermissions } from '@/middleware/rbac';

export function adminRoutes(
  fastify: FastifyInstance,
  _options: unknown,
  done: () => void,
) {
  // Reporting-shaped reads go to the replica when one is configured.
  const repository = new AdminRepository(fastify.prisma, fastify.prismaRead);
  const service = new AdminService(repository, fastify);
  const controller = new AdminController(service);

  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', requireRoles(['admin'])); // Strictly Admin only

  // Users
  fastify.get('/users', { preHandler: [requirePermissions(['manage_users'])] }, controller.listUsers as any);
  fastify.post('/users', { preHandler: [requirePermissions(['manage_users'])] }, controller.createUser as any);
  fastify.put('/users/:id', { preHandler: [requirePermissions(['manage_users'])] }, controller.updateUser as any);
  fastify.delete('/users/:id', { preHandler: [requirePermissions(['manage_users'])] }, controller.deleteUser as any);
  fastify.patch('/users/:id/status', { preHandler: [requirePermissions(['manage_users'])] }, controller.updateUserStatus as any);

  // Responders
  fastify.get('/responders', { preHandler: [requirePermissions(['manage_users'])] }, controller.listResponders as any);
  fastify.patch('/responders/:id/verify', { preHandler: [requirePermissions(['manage_users'])] }, controller.verifyResponder as any);
  fastify.delete('/responders/:id', { preHandler: [requirePermissions(['manage_users'])] }, controller.deleteResponder as any);

  // Audit Logs
  fastify.get('/audit-logs', { preHandler: [requirePermissions(['view_audit_logs'])] }, controller.listAuditLogs as any);
  
  // Health
  fastify.get('/health', controller.getHealth as any);

  // Alerts
  fastify.get('/alerts', controller.listAlerts as any);
  fastify.get('/alerts/:id', controller.getAlertById as any);

  // Incidents
  fastify.get('/incidents', controller.listIncidents as any);
  fastify.patch('/incidents/:id/status', controller.updateIncidentStatus as any);
  
  // Analytics
  fastify.get('/analytics', controller.getAnalytics as any);

  done();
}
