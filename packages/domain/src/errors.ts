import { HTTP_STATUS_FOR_CODE, type ApiErrorCode, type FieldError } from '@influenceos/contracts';

/**
 * Domain-level error carrying an API error code. The API layer translates this
 * straight into the standardized error envelope (never leaks raw DB errors).
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly fieldErrors?: FieldError[];
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { fieldErrors?: FieldError[]; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_FOR_CODE[code];
    this.fieldErrors = opts.fieldErrors;
    this.details = opts.details;
  }

  static notFound(what = 'Resource') {
    return new AppError('NOT_FOUND', `${what} not found.`);
  }
  static forbidden(message = 'You do not have access to this resource.') {
    return new AppError('FORBIDDEN', message);
  }
  static unauthorized(message = 'Authentication required.') {
    return new AppError('UNAUTHORIZED', message);
  }
  static conflict(message: string) {
    return new AppError('CONFLICT', message);
  }
  static badRequest(message: string) {
    return new AppError('BAD_REQUEST', message);
  }
  static validation(message: string, fieldErrors?: FieldError[]) {
    return new AppError('VALIDATION_ERROR', message, { fieldErrors });
  }
}
