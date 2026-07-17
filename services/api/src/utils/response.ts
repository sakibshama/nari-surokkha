/**
 * Standard API response helpers.
 *
 * Every endpoint must use these helpers to produce consistent JSON responses.
 * Deviating from this format will break the mobile app and police portal.
 *
 * Shape matches the ApiSuccess / ApiError types in @nari-surokkha/shared.
 */

import { FastifyReply } from 'fastify';
import { HTTP_STATUS } from '@nari-surokkha/shared';

// ─── Success ─────────────────────────────────────────────────

/**
 * Send a 200 OK success response.
 */
export function sendSuccess<T>(
  reply: FastifyReply,
  data: T,
  message?: string,
  statusCode: number = HTTP_STATUS.OK,
): void {
  void reply.status(statusCode).send({
    success: true,
    data,
    ...(message ? { message } : {}),
  });
}

/**
 * Send a 201 Created success response.
 */
export function sendCreated<T>(reply: FastifyReply, data: T, message?: string): void {
  sendSuccess(reply, data, message, HTTP_STATUS.CREATED);
}

/**
 * Send a 204 No Content success response.
 */
export function sendNoContent(reply: FastifyReply): void {
  void reply.status(HTTP_STATUS.NO_CONTENT).send();
}

// ─── Paginated ────────────────────────────────────────────────

export interface PaginatedData<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Send a paginated success response.
 */
export function sendPaginated<T>(
  reply: FastifyReply,
  items: T[],
  total: number,
  page: number,
  limit: number,
): void {
  sendSuccess<PaginatedData<T>>(reply, {
    items,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// ─── Error ────────────────────────────────────────────────────

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Build a standardised error response body (not send — used by error handler).
 */
export function buildError(code: string, message: string, details?: unknown): object {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
