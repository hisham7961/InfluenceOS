import { statfs } from 'node:fs/promises';

export interface DiskUsage {
  usedPercent: number;
  freeBytes: number;
  totalBytes: number;
  status: 'ok' | 'degraded' | 'down';
}

/**
 * Space left on the filesystem holding `path`. Inside a container, `/` sits on
 * the host's Docker disk — the same disk as the database and uploaded files —
 * so this is the early warning before Postgres stops on a full disk.
 */
export async function diskUsage(path = '/'): Promise<DiskUsage | null> {
  try {
    const s = await statfs(path);
    const totalBytes = s.blocks * s.bsize;
    if (!totalBytes) return null;
    const freeBytes = s.bavail * s.bsize;
    const usedPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);
    const status = usedPercent >= 95 ? 'down' : usedPercent >= 85 ? 'degraded' : 'ok';
    return { usedPercent, freeBytes, totalBytes, status };
  } catch {
    return null;
  }
}
