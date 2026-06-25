const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]+/g,
  /\b(?:sk-|pk-)[A-Za-z0-9_-]{12,}\b/g,
  /\b(password|passwd|secret|token|api[_-]?key|auth)(["']?\s*[:=]\s*["']?)[A-Za-z0-9_\-./+=]{8,}/gi,
] as const;

export function redactSecrets(input: string): string {
  return SECRET_PATTERNS.reduce((value, pattern) => {
    if (pattern.source.startsWith("\\b(password")) {
      return value.replace(pattern, "$1$2[REDACTED]");
    }
    return value.replace(pattern, "[REDACTED]");
  }, input);
}

export function sanitizeGitRemote(remote: string | null): string | null {
  if (remote === null) return null;
  return redactSecrets(remote).replace(/(https?:\/\/)([^/@\s]+)@/gi, "$1[REDACTED]@");
}
