import dns from 'dns/promises';
import net from 'net';

export interface WebhookValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedUrl?: string;
}

/**
 * Checks if an IPv4 address is in a private, loopback, or reserved range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  // 0.0.0.0/8
  if (parts[0] === 0) return true;
  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Private: 172.16 - 172.31)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 224.0.0.0/4 (Multicast)
  if (parts[0] >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address is loopback, unique local, link-local, or IPv4-mapped private.
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // Loopback ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  // Unique local fc00::/7 (fc.. or fd..)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // Link-local fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  // IPv4 mapped (e.g. ::ffff:127.0.0.1)
  if (normalized.includes('::ffff:')) {
    const v4Part = normalized.split('::ffff:')[1];
    if (v4Part && net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
    return true;
  }

  return false;
}

/**
 * Retrieves the list of approved webhook destinations from environment.
 */
export function getAllowedWebhookDestinations(): string[] {
  const envDest = process.env.ALLOWED_WEBHOOK_DESTINATIONS || '';
  return envDest
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validates a webhook destination against SSRF attacks and destination allowlists.
 */
export async function validateWebhookUrl(rawUrl: string): Promise<WebhookValidationResult> {
  // Check if webhook delivery is enabled
  const isEnabled = process.env.ENABLE_BROKER_WEBHOOK === 'true';
  if (!isEnabled) {
    return {
      valid: false,
      reason: 'External webhook delivery is currently disabled by server policy (ENABLE_BROKER_WEBHOOK=false). Only simulated sandbox receipts are supported.',
    };
  }

  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Webhook URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }

  // Enforce HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Webhook destinations must use the secure HTTPS protocol.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject raw IP addresses in hostname unless explicitly permitted
  if (net.isIP(hostname)) {
    return { valid: false, reason: 'Direct IP addresses are not permitted as webhook destinations. Use a verified domain name.' };
  }

  // Reject local and internal hostnames
  const forbiddenHosts = ['localhost', 'local', 'internal', 'lan', 'corp'];
  if (forbiddenHosts.some((fh) => hostname === fh || hostname.endsWith(`.${fh}`))) {
    return { valid: false, reason: `Target host "${hostname}" is an internal domain and cannot be accessed.` };
  }

  // Check against destination allowlist if configured
  const allowed = getAllowedWebhookDestinations();
  if (allowed.length > 0) {
    const isMatched = allowed.some((allowedHost) => {
      return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
    });
    if (!isMatched) {
      return {
        valid: false,
        reason: `Destination domain "${hostname}" is not in the server-approved webhook allowlist.`,
      };
    }
  }

  // Resolve DNS to verify it does not resolve to a private/loopback IP address
  try {
    const lookupResults = await dns.lookup(hostname, { all: true });
    for (const record of lookupResults) {
      if (record.family === 4 && isPrivateIPv4(record.address)) {
        return {
          valid: false,
          reason: `Destination resolves to a restricted private IP address (${record.address}).`,
        };
      }
      if (record.family === 6 && isPrivateIPv6(record.address)) {
        return {
          valid: false,
          reason: `Destination resolves to a restricted IPv6 address (${record.address}).`,
        };
      }
    }
  } catch (dnsErr: any) {
    return {
      valid: false,
      reason: `DNS resolution failed for "${hostname}": ${dnsErr?.message || 'Host unreachable'}`,
    };
  }

  return {
    valid: true,
    sanitizedUrl: parsed.toString(),
  };
}
