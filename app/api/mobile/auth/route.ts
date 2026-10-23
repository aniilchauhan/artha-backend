import { NextRequest, NextResponse } from 'next/server';
import { encode } from 'next-auth/jwt';
import { authenticateAccount, configuredAuthSecret } from '../../../../lib/authenticate';
import { requireAuth } from '../../../../lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const result = await requireAuth(req);
  if (!result.authenticated) return result.response;

  const user = result.session.user;
  if (!user.email) {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    user: {
      id: user.id || '',
      email: user.email.toLowerCase(),
      role: user.role || 'user',
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ success: false, error: 'Email and password are required.' }, { status: 400 });
  }
  try {
    const user = await authenticateAccount(body.email, body.password);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid credentials.' }, { status: 401 });
    const token = await encode({ token: { sub: user.id, ...user }, secret: configuredAuthSecret(), maxAge: 24 * 60 * 60 });
    return NextResponse.json({ success: true, token, user }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ success: false, error: 'Sign-in unavailable or temporarily limited. Try again later.' }, { status: 503 });
  }
}
