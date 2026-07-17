/**
 * ML Repository — data access for the model registry and training samples.
 */

import { PrismaClient, Prisma } from '@prisma/client';

export interface CreateModelInput {
  kind: string;
  version: number;
  format: string;
  fileKey: string;
  checksum: string;
  sizeBytes: number;
  metadata: Prisma.InputJsonValue;
  createdBy?: string | null;
}

export interface CreateSampleInput {
  userId?: string | null;
  kind: string;
  label?: string | null;
  source: string;
  window: Prisma.InputJsonValue;
  sampleRate: number;
  deviceInfo?: Prisma.InputJsonValue;
}

export class MlRepository {
  constructor(private readonly db: PrismaClient) {}

  getActiveModel(kind: string) {
    return this.db.mlModel.findFirst({
      where: { kind, isActive: true },
      orderBy: { version: 'desc' },
    });
  }

  getModelById(id: string) {
    return this.db.mlModel.findUnique({ where: { id } });
  }

  listModels(kind?: string) {
    return this.db.mlModel.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    });
  }

  nextVersion(kind: string): Promise<number> {
    return this.db.mlModel
      .aggregate({ where: { kind }, _max: { version: true } })
      .then((r) => (r._max.version ?? 0) + 1);
  }

  createModel(data: CreateModelInput) {
    return this.db.mlModel.create({ data });
  }

  /** Activate one model and deactivate all others of the same kind, atomically. */
  async setActive(id: string, kind: string) {
    return this.db.$transaction([
      this.db.mlModel.updateMany({ where: { kind }, data: { isActive: false } }),
      this.db.mlModel.update({ where: { id }, data: { isActive: true } }),
    ]);
  }

  createSample(data: CreateSampleInput) {
    return this.db.mlTrainingSample.create({ data });
  }

  exportSamples(kind: string, labeledOnly: boolean, limit: number) {
    return this.db.mlTrainingSample.findMany({
      where: { kind, ...(labeledOnly ? { label: { not: null } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, label: true, source: true, window: true, sampleRate: true, createdAt: true },
    });
  }

  async sampleStats(kind: string) {
    const byLabel = await this.db.mlTrainingSample.groupBy({
      by: ['label'],
      where: { kind },
      _count: { _all: true },
    });
    const bySource = await this.db.mlTrainingSample.groupBy({
      by: ['source'],
      where: { kind },
      _count: { _all: true },
    });
    const total = await this.db.mlTrainingSample.count({ where: { kind } });
    return { total, byLabel, bySource };
  }
}
