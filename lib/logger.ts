/**
 * Secret-safe logger for Axion.
 * Automatically redacts credentials, MongoDB connection URIs, Bearer tokens,
 * passwords, JWTs, and API keys from log outputs and error objects.
 */

const SENSITIVE_KEY_PATTERN = /^(password|pass|pwd|secret|token|bearer|authorization|cookie|apiKey|apikey|privateKey|credential|secretKey|hash)$/i;

const SENSITIVE_KEY_SUBSTRING = /(password|secret|bearer|authorization|apikey|api_key|access_token|refresh_token|private_key)/i;

const MONGO_URI_CREDENTIAL_PATTERN = /(mongodb(?:\+srv)?:\/\/)([^:@]+):([^@]+)@/gi;
const BEARER_TOKEN_PATTERN = /(bearer\s+)([a-zA-Z0-9\-_.]+)/gi;
const JWT_PATTERN = /\b(ey[a-zA-Z0-9-_]{10,}\.[a-zA-Z0-9-_]{10,}\.[a-zA-Z0-9-_]{10,})\b/g;
const GENERIC_API_KEY_PATTERN = /\b(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35})\b/g;

/**
 * Redacts sensitive substrings within plain text.
 */
export function sanitizeString(text: string): string {
  if (typeof text !== 'string') return String(text);

  return text
    .replace(MONGO_URI_CREDENTIAL_PATTERN, '$1[REDACTED_USER]:[REDACTED_PASS]@')
    .replace(BEARER_TOKEN_PATTERN, '$1[REDACTED_TOKEN]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(GENERIC_API_KEY_PATTERN, '[REDACTED_API_KEY]');
}

/**
 * Deeply sanitizes an object, array, or primitive, redacting sensitive keys and string patterns.
 */
export function sanitize<T = any>(value: T, seen = new WeakSet()): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value) as unknown as T;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'symbol' || typeof value === 'bigint') {
    return value;
  }

  if (value instanceof Error) {
    const sanitizedError: Record<string, any> = {
      name: value.name,
      message: sanitizeString(value.message),
    };
    if (value.stack) {
      sanitizedError.stack = sanitizeString(value.stack);
    }
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_KEY_SUBSTRING.test(key)) {
        sanitizedError[key] = '[REDACTED]';
      } else {
        sanitizedError[key] = sanitize(val, seen);
      }
    }
    return sanitizedError as unknown as T;
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[CIRCULAR]' as unknown as T;
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item, seen)) as unknown as T;
    }

    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_KEY_SUBSTRING.test(key)) {
        cleanObj[key] = '[REDACTED]';
      } else {
        cleanObj[key] = sanitize(val, seen);
      }
    }
    return cleanObj as unknown as T;
  }

  return value;
}

function formatArgs(args: any[]): any[] {
  return args.map((arg) => sanitize(arg));
}

export const logger = {
  info: (message: any, ...args: any[]) => {
    console.info(sanitize(message), ...formatArgs(args));
  },
  warn: (message: any, ...args: any[]) => {
    console.warn(sanitize(message), ...formatArgs(args));
  },
  error: (message: any, ...args: any[]) => {
    console.error(sanitize(message), ...formatArgs(args));
  },
  debug: (message: any, ...args: any[]) => {
    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG === 'true') {
      console.debug(sanitize(message), ...formatArgs(args));
    }
  },
  sanitize,
  sanitizeString,
};

export default logger;
