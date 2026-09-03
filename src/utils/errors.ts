export class OpenApiMcpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "OpenApiMcpError";
  }
}

export class SpecParseError extends OpenApiMcpError {
  constructor(message: string, cause?: unknown) {
    super(message, "SPEC_PARSE_ERROR", cause);
    this.name = "SpecParseError";
  }
}

export class ValidationError extends OpenApiMcpError {
  constructor(message: string, cause?: unknown) {
    super(message, "VALIDATION_ERROR", cause);
    this.name = "ValidationError";
  }
}

export class GenerationError extends OpenApiMcpError {
  constructor(message: string, cause?: unknown) {
    super(message, "GENERATION_ERROR", cause);
    this.name = "GenerationError";
  }
}

export class ExecutionError extends OpenApiMcpError {
  constructor(message: string, cause?: unknown) {
    super(message, "EXECUTION_ERROR", cause);
    this.name = "ExecutionError";
  }
}
