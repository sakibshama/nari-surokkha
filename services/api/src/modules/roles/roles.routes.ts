import { FastifyInstance } from 'fastify';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { RolesRepository } from './roles.repository';
import {
  createRoleSchema,
  updateRoleSchema,
  listRolesSchema,
  deleteRoleSchema
} from './roles.schemas';
import { requireRoles, requirePermissions } from '@/middleware/rbac';

export function rolesRoutes(
  fastify: FastifyInstance,
  _options: any,
  done: () => void,
) {
  const repository = new RolesRepository(fastify.prisma);
  const service = new RolesService(repository);
  const controller = new RolesController(service);

  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', requireRoles(['admin', 'superadmin']));
  // Roles decide what users can do, so managing them is user management.
  fastify.addHook('onRequest', requirePermissions(['manage_users']));

  fastify.get('/', { schema: listRolesSchema }, controller.listRoles);
  fastify.post('/', { schema: createRoleSchema }, controller.createRole);
  fastify.put('/:id', { schema: updateRoleSchema }, controller.updateRole);
  fastify.delete('/:id', { schema: deleteRoleSchema }, controller.deleteRole);

  done();
}
