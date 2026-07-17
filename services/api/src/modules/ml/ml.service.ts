/**
 * ML Service — business logic for the on-device model registry and the
 * real-data training loop.
 */

import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { MlRepository, CreateSampleInput } from './ml.repository';
import { ValidationError, NotFoundError } from '@/utils/errors';

// Must match the training config (services/ml-training/config.py) and the
// on-device modelConfig.ts.
const EXPECTED_CHANNELS = 6;
const MAX_WINDOW_ROWS = 512; // generous cap; real windows are 100 rows
const VALID_LABELS = ['normal', 'walking', 'fall', 'struggle'];
const VALID_SOURCES = ['confirmed_sos', 'false_alarm', 'manual', 'auto'];

export class MlService {
  constructor(
    private readonly repo: MlRepository,
    private readonly fastify: FastifyInstance,
  ) {}

  /** The active model a device should download, with a presigned URL. */
  async getActiveModel(kind: string) {
    const model = await this.repo.getActiveModel(kind);
    if (!model) return null;
    const downloadUrl = await this.fastify.storage.getPresignedUrl(model.fileKey, 3600);
    return {
      id: model.id,
      kind: model.kind,
      version: model.version,
      format: model.format,
      checksum: model.checksum,
      sizeBytes: model.sizeBytes,
      metadata: model.metadata,
      downloadUrl,
      createdAt: model.createdAt,
    };
  }

  async listModels(kind?: string) {
    const models = await this.repo.listModels(kind);
    return models.map((m) => ({
      id: m.id,
      kind: m.kind,
      version: m.version,
      format: m.format,
      sizeBytes: m.sizeBytes,
      checksum: m.checksum,
      isActive: m.isActive,
      metadata: m.metadata,
      createdAt: m.createdAt,
    }));
  }

  /** Store an uploaded model file and register it (inactive by default). */
  async uploadModel(params: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
    kind: string;
    format: string;
    metadata: unknown;
    userId?: string | null;
    activate?: boolean;
  }) {
    const { buffer, filename, mimetype, kind, format, metadata, userId } = params;
    if (!['json', 'tflite'].includes(format)) {
      throw new ValidationError('format must be "json" or "tflite"');
    }
    if (!buffer || buffer.length === 0) {
      throw new ValidationError('Empty model file');
    }

    const { fileKey, sizeBytes, checksum } = await this.fastify.storage.uploadFile(
      buffer,
      filename,
      mimetype,
    );
    const version = await this.repo.nextVersion(kind);

    const model = await this.repo.createModel({
      kind,
      version,
      format,
      fileKey,
      checksum,
      sizeBytes,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      createdBy: userId ?? null,
    });

    if (params.activate) {
      await this.repo.setActive(model.id, kind);
    }
    return { ...model, isActive: !!params.activate };
  }

  async activateModel(id: string) {
    const model = await this.repo.getModelById(id);
    if (!model) throw new NotFoundError('Model');
    await this.repo.setActive(model.id, model.kind);
    return { id: model.id, kind: model.kind, version: model.version, isActive: true };
  }

  /** Ingest a labelled/unlabelled sensor window from a device. */
  async ingestSample(input: {
    userId?: string | null;
    kind: string;
    label?: string | null;
    source: string;
    window: unknown;
    sampleRate: number;
    deviceInfo?: unknown;
  }) {
    if (input.label && !VALID_LABELS.includes(input.label)) {
      throw new ValidationError(`label must be one of: ${VALID_LABELS.join(', ')}`);
    }
    if (!VALID_SOURCES.includes(input.source)) {
      throw new ValidationError(`source must be one of: ${VALID_SOURCES.join(', ')}`);
    }
    this.validateWindow(input.window);

    const data: CreateSampleInput = {
      userId: input.userId ?? null,
      kind: input.kind,
      label: input.label ?? null,
      source: input.source,
      window: input.window as Prisma.InputJsonValue,
      sampleRate: input.sampleRate,
      deviceInfo: (input.deviceInfo ?? undefined) as Prisma.InputJsonValue | undefined,
    };
    const created = await this.repo.createSample(data);
    return { id: created.id };
  }

  private validateWindow(window: unknown): void {
    if (!Array.isArray(window) || window.length === 0 || window.length > MAX_WINDOW_ROWS) {
      throw new ValidationError(`window must be a non-empty array of <= ${MAX_WINDOW_ROWS} rows`);
    }
    for (const row of window) {
      if (!Array.isArray(row) || row.length !== EXPECTED_CHANNELS) {
        throw new ValidationError(`each window row must have ${EXPECTED_CHANNELS} numeric channels`);
      }
      for (const v of row) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new ValidationError('window contains a non-numeric value');
        }
      }
    }
  }

  exportSamples(kind: string, labeledOnly: boolean, limit: number) {
    return this.repo.exportSamples(kind, labeledOnly, Math.min(Math.max(limit, 1), 20000));
  }

  sampleStats(kind: string) {
    return this.repo.sampleStats(kind);
  }
}
