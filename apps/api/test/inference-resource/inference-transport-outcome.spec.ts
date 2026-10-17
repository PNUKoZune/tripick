/// <reference types="jest" />
import { isConfirmedConnectionFailure } from '../../src/inference-resource/inference-transport-outcome';

describe('confirmed model no-dispatch classification', () => {
  const refused = {
    isAxiosError: true, code: 'ECONNREFUSED', config: { maxRedirects: 0 },
    cause: { code: 'ECONNREFUSED', syscall: 'connect' },
  };

  it('accepts an explicit Node pre-connect failure with redirects disabled', () => {
    expect(isConfirmedConnectionFailure(refused)).toBe(true);
    // Buffered bytesWritten can be positive before TCP connection; it is not dispatch proof.
    expect(isConfirmedConnectionFailure({
      ...refused, request: { socket: { bytesRead: 0, bytesWritten: 262 } },
    })).toBe(true);
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])('accepts confirmed getaddrinfo failure %s', (code) => {
    expect(isConfirmedConnectionFailure({
      ...refused, code, cause: { code, syscall: 'getaddrinfo' },
    })).toBe(true);
  });

  it.each([
    { code: 'ECONNREFUSED' },
    { ...refused, isAxiosError: false },
    { ...refused, config: { maxRedirects: 5 } },
    { ...refused, config: {} },
    { ...refused, cause: { code: 'ECONNREFUSED', syscall: 'read' } },
    { ...refused, response: { status: 504 } },
    { ...refused, code: 'ECONNRESET', cause: { code: 'ECONNRESET', syscall: 'read' } },
    { ...refused, code: 'ECONNABORTED', cause: { code: 'ECONNABORTED', syscall: 'connect' } },
  ])('keeps ambiguous transport outcomes quarantined %j', (error) => {
    expect(isConfirmedConnectionFailure(error)).toBe(false);
  });
});
