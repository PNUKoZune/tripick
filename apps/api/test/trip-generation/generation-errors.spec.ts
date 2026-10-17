/// <reference types="jest" />
import type { ArgumentsHost } from '@nestjs/common';
import { GenerationAdmissionException, GenerationAdmissionFilter } from '../../src/trip-generation/generation-errors';

describe('GenerationAdmissionFilter', () => {
  it.each([
    ['USER_GENERATION_LIMIT', 429], ['GENERATION_QUEUE_FULL', 429], ['GENERATION_ADMISSION_PAUSED', 503],
  ] as const)('writes Retry-After on %s HTTP responses', (code, status) => {
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new GenerationAdmissionFilter().catch(new GenerationAdmissionException(code), host);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code, statusCode: status, retryAfter: 30 }));
  });
});
