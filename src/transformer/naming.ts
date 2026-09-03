/**
 * Sanitize and derive MCP tool names.
 * MCP spec requires tool names to match ^[a-zA-Z0-9_-]{1,64}$
 * We prefer operationId; fallback to method_path slugification.
 */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_")
    .slice(0, 64)
    .replace(/_+$/g, "");
}

export function sanitizeToolName(name: string): string {
  // Replace invalid chars with underscore, ensure starts with letter/number/underscore
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  sanitized = sanitized.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (sanitized.length === 0) sanitized = "unnamed_tool";
  if (sanitized.length > 64) sanitized = sanitized.slice(0, 64).replace(/_+$/g, "");
  // Must not start with hyphen; prefix if needed
  if (sanitized.startsWith("-")) sanitized = `tool${sanitized}`;
  return sanitized;
}

export function deriveToolName(
  operationId: string | undefined,
  method: string,
  path: string
): string {
  if (operationId && operationId.trim().length > 0) {
    return sanitizeToolName(operationId.trim());
  }
  // Fallback: method + path slug
  // e.g., GET /pets/{id} -> get_pets_by_id
  const pathSlug = path
    .replace(/{([^}]+)}/g, "by_$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const raw = `${method.toLowerCase()}_${pathSlug}`;
  return sanitizeToolName(slugify(raw));
}

export function ensureUniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    if (count === 0) {
      seen.set(name, 1);
      return name;
    }
    // duplicate -> suffix with _2, _3 etc, keeping within 64 chars
    let suffix = `_${count + 1}`;
    let base = name;
    if (base.length + suffix.length > 64) {
      base = base.slice(0, 64 - suffix.length);
    }
    const unique = `${base}${suffix}`;
    seen.set(name, count + 1);
    seen.set(unique, 1);
    return unique;
  });
}
