/**
 * A file upload that didn't go through. `reason` says why, in a way the UI
 * can put into the viewer's language (errorMessage() does): the connection
 * dropped, the server turned the file down (its own message, when it sent
 * one), or storage answered with an error.
 */
export class UploadError extends Error {
  constructor(
    readonly reason: 'network' | 'rejected' | 'failed',
    readonly status: number | null = null,
    /** The server's own message (English, translated by errorMessage()). */
    readonly serverMessage: string | null = null,
  ) {
    super(
      serverMessage ??
        (reason === 'network' ? 'Upload failed — network error.' : `Upload failed (${status}).`),
    );
    this.name = 'UploadError';
  }
}
