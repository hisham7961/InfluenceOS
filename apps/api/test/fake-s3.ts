import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny in-process stand-in for an S3-compatible store (path-style, no auth
 * check) so the s3 driver can be exercised end to end where no MinIO runs.
 * CI runs the same suites against a real MinIO (S3_TEST_ENDPOINT); this only
 * covers what the app uses: buckets (head/create/list), objects (put, copy,
 * get with a byte range, head, delete).
 */
export interface FakeS3 {
  endpoint: string;
  /** `${bucket}/${key}` → stored object. */
  objects: Map<string, { body: Buffer; type: string; modified: Date }>;
  close(): Promise<void>;
}

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function startFakeS3(): Promise<FakeS3> {
  const buckets = new Set<string>();
  const objects: FakeS3['objects'] = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake-s3');
    const [bucketPart = '', ...keyParts] = url.pathname.slice(1).split('/');
    const bucket = decodeURIComponent(bucketPart);
    const key = keyParts.map(decodeURIComponent).join('/');
    const id = `${bucket}/${key}`;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const fail = (status: number, code: string) => {
        if (req.method === 'HEAD') {
          res.writeHead(status).end();
          return;
        }
        res.writeHead(status, { 'content-type': 'application/xml' });
        res.end(
          xml(
            `<Error><Code>${code}</Code><Message>${code}</Message><Resource>${esc(url.pathname)}</Resource></Error>`,
          ),
        );
      };

      if (!key) {
        if (req.method === 'HEAD') return void res.writeHead(buckets.has(bucket) ? 200 : 404).end();
        if (req.method === 'PUT') {
          buckets.add(bucket);
          return void res.writeHead(200).end();
        }
        if (req.method === 'GET') {
          const prefix = url.searchParams.get('prefix') ?? '';
          const items = [...objects.entries()]
            .filter(([k]) => k.startsWith(`${bucket}/${prefix}`))
            .map(
              ([k, o]) =>
                `<Contents><Key>${esc(k.slice(bucket.length + 1))}</Key><LastModified>${o.modified.toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`,
            )
            .join('');
          res.writeHead(200, { 'content-type': 'application/xml' });
          return void res.end(
            xml(
              `<ListBucketResult><Name>${esc(bucket)}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${items.length}</KeyCount><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`,
            ),
          );
        }
        return fail(405, 'MethodNotAllowed');
      }

      if (!buckets.has(bucket)) return fail(404, 'NoSuchBucket');

      if (req.method === 'PUT') {
        const copySource = req.headers['x-amz-copy-source'];
        if (typeof copySource === 'string') {
          const from = objects.get(decodeURIComponent(copySource.replace(/^\//, '')));
          if (!from) return fail(404, 'NoSuchKey');
          const modified = new Date();
          objects.set(id, { ...from, modified });
          res.writeHead(200, { 'content-type': 'application/xml' });
          return void res.end(
            xml(
              `<CopyObjectResult><LastModified>${modified.toISOString()}</LastModified><ETag>"copy"</ETag></CopyObjectResult>`,
            ),
          );
        }
        objects.set(id, {
          body: Buffer.concat(chunks),
          type: String(req.headers['content-type'] ?? 'application/octet-stream'),
          modified: new Date(),
        });
        return void res.writeHead(200, { etag: '"fake"' }).end();
      }

      const obj = objects.get(id);
      if (req.method === 'DELETE') {
        objects.delete(id);
        return void res.writeHead(204).end();
      }
      if (!obj) return fail(404, 'NoSuchKey');

      const headers = {
        'content-type': obj.type,
        'last-modified': obj.modified.toUTCString(),
        etag: '"fake"',
        'accept-ranges': 'bytes',
      };
      if (req.method === 'HEAD') {
        return void res
          .writeHead(200, { ...headers, 'content-length': String(obj.body.length) })
          .end();
      }
      if (req.method === 'GET') {
        const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(Number(m[2]), obj.body.length - 1);
          if (start >= obj.body.length) return fail(416, 'InvalidRange');
          const part = obj.body.subarray(start, end + 1);
          res.writeHead(206, {
            ...headers,
            'content-length': String(part.length),
            'content-range': `bytes ${start}-${end}/${obj.body.length}`,
          });
          return void res.end(part);
        }
        res.writeHead(200, { ...headers, 'content-length': String(obj.body.length) });
        return void res.end(obj.body);
      }
      return fail(405, 'MethodNotAllowed');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
