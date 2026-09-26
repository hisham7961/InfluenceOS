import { describe, expect, it } from 'vitest';
import { buildIdentity } from '../utils/build-identity';

describe('buildIdentity', () => {
  it('prefers an explicit deploy value, then the one baked into the image', () => {
    expect(buildIdentity({ GIT_SHA: 'abc', BUILD_GIT_SHA: 'def' }).gitSha).toBe('abc');
    expect(buildIdentity({ GIT_SHA: '', BUILD_GIT_SHA: 'def', BUILD_BUILT_AT: '2026-01-01T00:00:00Z' })).toEqual({
      gitSha: 'def',
      buildTime: '2026-01-01T00:00:00Z',
    });
  });

  it('treats empty and "unknown" as not provided', () => {
    expect(buildIdentity({ GIT_SHA: ' ', BUILD_GIT_SHA: 'unknown', BUILD_TIME: '' })).toEqual({
      gitSha: 'unknown',
      buildTime: null,
    });
  });
});
