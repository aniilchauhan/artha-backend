import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import connectToDatabase from '../../../../lib/mongodb';
import User from '../../../../models/User';
import { verifyRequestOrigin } from '../../../../lib/auth-guard';

export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req)) {
    return NextResponse.json({ success: false, error: 'Invalid request origin' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.token !== 'string' || body.token.length < 32) {
    return NextResponse.json({ success: false, error: 'A valid verification token is required.' }, { status: 400 });
  }

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ success: false, error: 'Database service unavailable.' }, { status: 503 });
  }

  await connectToDatabase();
  const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
  const user = await User.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpiresAt: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');

  if (!user) {
    return NextResponse.json({ success: false, error: 'Verification token is invalid or expired.' }, { status: 400 });
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpiresAt = undefined;
  await user.save();
  return NextResponse.json({ success: true, message: 'Email verified. You may now sign in.' });
}