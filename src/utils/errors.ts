export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN')
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, message, 'CONFLICT')
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(422, message, 'VALIDATION_ERROR')
  }
}
