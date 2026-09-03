import { ValidationError } from "./errors.js";

export function assertValidInput(input: string): void {
  if (!input || typeof input !== "string" || input.trim() === "") {
    throw new ValidationError("Input spec path/URL must be a non-empty string");
  }
}

export function assertValidOutputDir(outputDir: string): void {
  if (!outputDir || typeof outputDir !== "string" || outputDir.trim() === "") {
    throw new ValidationError("Output directory must be a non-empty string");
  }
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function sanitizeServerName(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || fallback;
}
