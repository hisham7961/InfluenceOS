/**
 * Which build is running. CI bakes the commit into every image as
 * BUILD_GIT_SHA / BUILD_BUILT_AT; a deploy may also set GIT_SHA / BUILD_TIME
 * explicitly. Compose passes GIT_SHA through even when it is unset on the
 * host, so an empty value means "not provided", never a real SHA.
 */
export function buildIdentity(env: Record<string, string | undefined> = process.env): {
  gitSha: string;
  buildTime: string | null;
} {
  const pick = (...keys: string[]) => keys.map((k) => env[k]?.trim()).find((v) => v && v !== 'unknown');
  return {
    gitSha: pick('GIT_SHA', 'BUILD_GIT_SHA') ?? 'unknown',
    buildTime: pick('BUILD_TIME', 'BUILD_BUILT_AT') ?? null,
  };
}
