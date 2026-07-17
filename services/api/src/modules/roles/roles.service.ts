import { RolesRepository } from './roles.repository';
import { ValidationError, NotFoundError } from '@/utils/errors';

export class RolesService {
  constructor(private readonly repo: RolesRepository) {}

  async listRoles() {
    return this.repo.listRoles();
  }

  async createRole(data: { name: string; key: string; description?: string }) {
    // Basic validation to avoid system keys
    if (['admin', 'superadmin', 'citizen', 'responder', 'police'].includes(data.key)) {
      throw new ValidationError('Reserved role key');
    }
    try {
      return await this.repo.createRole(data);
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ValidationError('A role with this key already exists');
      }
      throw error;
    }
  }

  async updateRole(id: string, data: { name?: string; description?: string }) {
    const role = await this.repo.getRoleById(id);
    if (!role) {
      throw new NotFoundError('Role not found');
    }
    
    return this.repo.updateRole(id, data);
  }

  async deleteRole(id: string) {
    const role = await this.repo.getRoleById(id);
    if (!role) {
      throw new NotFoundError('Role not found');
    }

    if (role.isSystem) {
      throw new ValidationError('System roles cannot be deleted');
    }

    await this.repo.deleteRole(id);
  }
}
