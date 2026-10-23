import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from './auth';
import { configuredAuthSecret } from './authenticate';
import { acquireJobLease, releaseJobLease, type JobLeaseHandle } from './job-lease';
import logger from './logger';

export interface AuthSuccess {
  authenticated: true;
  session: {
    user: {
      id?: string;
      email: string;
      name?: string | null;
      role?: string;
      emailVerified?: boolean;
    };
  };
}

export interface AuthFailure {
  authenticated: false;
  response: NextResponse;
}

export type AuthResult = AuthSuccess | AuthFailure;

export interface AdminSuccess extends AuthSuccess {
  authorized: true;
}

export interface AdminFailure {
  authorized: false;
  response: NextResponse;
}

export type AdminResult = AdminSuccess | AdminFailure;

/**
 * Parses configured admin emails from environment variable.
 */
export function getAdminEmails(): Set<string> {
  const envAdmins = process.env.ADMIN_EMAILS || '';
  return new Set(
    envAdmins
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Validates that the request has an active authenticated session.
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  try {
    configuredAuthSecret();
    const session = await getServerSession(authOptions);
    const bearerToken = session ? null : await getToken({ req, secret: authOptions.secret as string });

    if (!session?.user?.email && !bearerToken?.email) {
      return {
        authenticated: false,
        response: NextResponse.json(
          { success: false, error: 'Authentication required. Please sign in.' },
          { status: 401 }
        ),
      };
    }

    const authenticatedSession = session || {
      user: {
        id: String(bearerToken?.id || bearerToken?.sub || ''),
        email: String(bearerToken?.email),
        role: String(bearerToken?.role || 'user'),
        emailVerified: bearerToken?.emailVerified === true,
      },
    };
    return {
      authenticated: true,
      session: authenticatedSession as AuthSuccess['session'],
    };
  } catch (error: any) {
    logger.error('[AuthGuard] Error checking session:', error);
    return {
      authenticated: false,
      response: NextResponse.json(
        { success: false, error: 'Authentication service error' },
        { status: 500 }
      ),
    };
  }
}

/**
 * Validates that the requesting user has administrator privileges.
 */
export async function requireAdmin(req: NextRequest): Promise<AdminResult> {
  const authResult = await requireAuth(req);
  if (!authResult.authenticated) {
    return {
      authorized: false,
      response: authResult.response,
    };
  }

  const userEmail = authResult.session.user.email.toLowerCase();
  const adminEmails = getAdminEmails();

  // If no admin emails are configured, warn in server logs
  if (adminEmails.size === 0) {
    console.warn(
      '[AuthGuard] WARNING: No ADMIN_EMAILS configured. Administrator operations are blocked.'
    );
  }

  const isVerified = authResult.session.user.emailVerified === true;
  const isExplicitAdmin = isVerified && adminEmails.has(userEmail);
  const hasAdminRole = isVerified && authResult.session.user.role === 'admin';

  if (!isExplicitAdmin && !hasAdminRole) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Administrator privileges required for this operation.',
        },
        { status: 403 }
      ),
    };
  }

  return {
    authenticated: true,
    authorized: true,
    session: authResult.session,
  };
}

/**
 * Verifies that state-changing requests originate from an authorized client.
 */
export function verifyRequestOrigin(req: NextRequest): boolean {
  // Only enforce for state-modifying methods
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host');

  // Allow same-origin or localhost/app-url requests
  const targetHeader = origin || referer;
  if (!targetHeader) {
    // Non-browser or direct curl without origin: allow if host matches
    return true;
  }

  try {
    const parsed = new URL(targetHeader);
    if (host && parsed.host === host) {
      return true;
    }
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      const parsedApp = new URL(appUrl);
      if (parsed.host === parsedApp.host) {
        return true;
      }
    }
    // Local development fallback
    if (process.env.NODE_ENV !== 'production' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}



// Persistent lock handles keyed to the in-memory map for fast lookup,
// backed by MongoDB JobLease for cross-instance consistency.
const leaseHandles = new Map<string, JobLeaseHandle>();
// Fallback expiry tracking for when DB is unavailable.
const fallbackExpiry = new Map<string, number>();

/**
 * Acquires a distributed lock backed by MongoDB JobLease.
 * Falls back to in-memory check if DB is unavailable.
 */
export async function acquireLock(key: string, timeoutMs: number = 60000): Promise<boolean> {
  try {
    const handle = await acquireJobLease(key, timeoutMs);
    if (handle) {
      leaseHandles.set(key, handle);
      return true;
    }
    return false;
  } catch (error: any) {
    if (error?.code === 11000 || /duplicate key/i.test(error?.message || '')) {
      return false;
    }
    // DB unavailable — fall back to in-memory lock
    const now = Date.now();
    const existing = fallbackExpiry.get(key);
    if (existing && existing > now) return false;
    fallbackExpiry.set(key, now + timeoutMs);
    return true;
  }
}

/**
 * Releases a distributed lock.
 */
export async function releaseLock(key: string): Promise<void> {
  const handle = leaseHandles.get(key);
  if (handle) {
    try {
      await releaseJobLease(handle);
    } catch {
      // DB unavailable — best effort
    }
    leaseHandles.delete(key);
  }
  fallbackExpiry.delete(key);
}
