import { PrismaClient, Role } from '@prisma/client';

export class RolesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listRoles(): Promise<Role[]> {
    return this.prisma.role.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async getRoleById(id: string): Promise<Role | null> {
    return this.prisma.role.findUnique({
      where: { id }
    });
  }

  async createRole(data: { name: string; key: string; description?: string }): Promise<Role> {
    return this.prisma.role.create({
      data: {
        ...data,
        isSystem: false
      }
    });
  }

  async updateRole(id: string, data: { name?: string; description?: string }): Promise<Role> {
    return this.prisma.role.update({
      where: { id },
      data
    });
  }

  async deleteRole(id: string): Promise<void> {
    await this.prisma.role.delete({
      where: { id }
    });
  }
}
