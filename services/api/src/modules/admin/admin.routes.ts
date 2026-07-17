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
  const repository = new AdminRepository(fastify.prisma);
  const service = new AdminService(repository);
  const controller = new AdminController(service);

  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', requireRoles(['admin'])); // Strictly Admin only

  // Users
  fastify.get('/users', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.listUsers(req, reply));
  fastify.post('/users', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.createUser(req, reply));
  fastify.put('/users/:id', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.updateUser(req, reply));
  fastify.delete('/users/:id', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.deleteUser(req, reply));
  fastify.patch('/users/:id/status', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.updateUserStatus(req, reply));

  // Responders
  fastify.get('/responders', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.listResponders(req, reply));
  fastify.patch('/responders/:id/verify', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.verifyResponder(req, reply));
  fastify.delete('/responders/:id', { preHandler: [requirePermissions(['manage_users'])] }, (req: any, reply: any) => controller.deleteResponder(req, reply));

  // Stations
  fastify.get('/stations', { preHandler: [requirePermissions(['manage_stations'])] }, (req: any, reply: any) => controller.listStations(req, reply));
  fastify.post('/stations', { preHandler: [requirePermissions(['manage_stations'])] }, (req: any, reply: any) => controller.createStation(req, reply));
  fastify.put('/stations/:id', { preHandler: [requirePermissions(['manage_stations'])] }, (req: any, reply: any) => controller.updateStation(req, reply));
  fastify.delete('/stations/:id', { preHandler: [requirePermissions(['manage_stations'])] }, (req: any, reply: any) => controller.deleteStation(req, reply));

  // Audit Logs
  fastify.get('/audit-logs', { preHandler: [requirePermissions(['view_audit_logs'])] }, (req: any, reply: any) => controller.listAuditLogs(req, reply));
  
  // Health
  fastify.get('/health', (req: any, reply: any) => controller.getHealth(req, reply));

  // Alerts
  fastify.get('/alerts', (req: any, reply: any) => controller.listAlerts(req, reply));
  fastify.get('/alerts/:id', (req: any, reply: any) => controller.getAlertById(req, reply));

  // Incidents
  fastify.get('/incidents', (req: any, reply: any) => controller.listIncidents(req, reply));
  fastify.patch('/incidents/:id/status', (req: any, reply: any) => controller.updateIncidentStatus(req, reply));
  
  // Analytics
  fastify.get('/analytics', (req: any, reply: any) => controller.getAnalytics(req, reply));

  done();
}
