import { FastifyRequest, FastifyReply } from 'fastify';
import { RolesService } from './roles.service';

export class RolesController {
  constructor(private readonly service: RolesService) {}

  listRoles = async (_req: FastifyRequest, reply: FastifyReply) => {
    const roles = await this.service.listRoles();
    return reply.send({ success: true, data: roles });
  };

  createRole = async (req: FastifyRequest<{ Body: { name: string; key: string; description?: string } }>, reply: FastifyReply) => {
    const role = await this.service.createRole(req.body);
    return reply.code(201).send({ success: true, data: role });
  };

  updateRole = async (req: FastifyRequest<{ Params: { id: string }, Body: { name?: string; description?: string } }>, reply: FastifyReply) => {
    const role = await this.service.updateRole(req.params.id, req.body);
    return reply.send({ success: true, data: role });
  };

  deleteRole = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.deleteRole(req.params.id);
    return reply.send({ success: true, message: 'Role deleted successfully' });
  };
}
