import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import User from '../../../../models/User';
import { validateProfileUpdates } from '../../../../lib/profile-validation';
import { commitPortfolioSave, PORTFOLIO_FIELDS } from '../../../../lib/portfolio-save';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../lib/auth';
import { verifyRequestOrigin, requireAuth } from '../../../../lib/auth-guard';
import logger from '../../../../lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    let session = await getServerSession(authOptions);
    if (!session?.user?.email && typeof requireAuth === 'function' && req && typeof req.headers?.get === 'function') {
      try {
        const authResult = await requireAuth(req);
        if (authResult?.authenticated) {
          session = authResult.session;
        }
      } catch {
        // If requireAuth fails or dependencies are mocked in test runner, proceed to standard session check
      }
    }

    if (!session || !session.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Sign in required.' }, { status: 401 });
    }

    const email = session.user.email.toLowerCase();
    const requestedAccount = req.headers?.get('X-Portfolio-Account')?.toLowerCase();
    if (requestedAccount && requestedAccount !== email) {
      return NextResponse.json({ success: false, error: 'The signed-in account changed. Reload before continuing.' }, { status: 403 });
    }

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ success: false, error: 'Database service unavailable. Portfolio was not replaced.' }, { status: 503 });
    }
    try {
      await connectToDatabase();
    } catch {
      return NextResponse.json({ success: false, error: 'Database service unavailable. Portfolio was not replaced.' }, { status: 503 });
    }

    // Query user profile without password hash
    const user = await User.findOne({ email }).select('-password').lean();

    // If user profile record does not yet exist in MongoDB, return empty profile state
    // rather than mutating the database implicitly on a GET request.
    if (!user) {
      return NextResponse.json({
        success: true,
        portfolioVersion: 0,
        watchlist: [],
        customTickers: [],
        holdings: {},
        thresholds: {},
        portfolioTransactions: [],
        portfolioCash: 100000,
        portfolioEquityHistory: [],
        portfolioRiskRules: {},
        savedFilters: [],
        watchlistGroups: [],
      });
    }

    // Safely extract Map or Object fields
    const holdings = user.holdings instanceof Map
      ? Object.fromEntries(user.holdings)
      : (user.holdings || {});
    const thresholds = user.thresholds instanceof Map
      ? Object.fromEntries(user.thresholds)
      : (user.thresholds || {});
    const portfolioRiskRules = user.portfolioRiskRules instanceof Map
      ? Object.fromEntries(user.portfolioRiskRules)
      : (user.portfolioRiskRules || {});

    return NextResponse.json({
      success: true,
      portfolioVersion: user.portfolioVersion ?? 0,
      watchlist: user.watchlist || [],
      customTickers: user.customTickers || [],
      holdings,
      thresholds,
      portfolioTransactions: user.portfolioTransactions || [],
      portfolioCash: user.portfolioCash ?? 100000,
      portfolioEquityHistory: user.portfolioEquityHistory || [],
      portfolioRiskRules,
      savedFilters: user.savedFilters || [],
      watchlistGroups: user.watchlistGroups || [],
    });
  } catch (error: any) {
    logger.error('[Profile GET Error]', error);
    return NextResponse.json({ success: false, error: 'Failed to retrieve profile data.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyRequestOrigin(req)) {
      return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 });
    }

    let session = await getServerSession(authOptions);
    if (!session?.user?.email && typeof requireAuth === 'function' && req && typeof req.headers?.get === 'function') {
      try {
        const authResult = await requireAuth(req);
        if (authResult?.authenticated) {
          session = authResult.session;
        }
      } catch {
        // If requireAuth fails or dependencies are mocked in test runner, proceed to standard session check
      }
    }

    if (!session || !session.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Sign in required.' }, { status: 401 });
    }

    const email = session.user.email.toLowerCase();
    const requestedAccount = req.headers?.get('X-Portfolio-Account')?.toLowerCase();
    if (requestedAccount && requestedAccount !== email) {
      return NextResponse.json({ success: false, error: 'The signed-in account changed. Reload before continuing.' }, { status: 403 });
    }

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ success: false, error: 'Database service unavailable' }, { status: 503 });
    }

    const rawBody = await req.json().catch(() => null);
    const isVersioned = rawBody && typeof rawBody === 'object' && 'updates' in rawBody;
    const { valid, error: validationError, cleanUpdates } = validateProfileUpdates(isVersioned ? rawBody.updates : rawBody);

    if (!valid || !cleanUpdates) {
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }

    const hasPortfolio = PORTFOLIO_FIELDS.some(field => field in cleanUpdates);
    if (hasPortfolio && !isVersioned) {
      return NextResponse.json({ success: false, error: 'Reload the app before saving portfolio changes.' }, { status: 428 });
    }
    if (isVersioned) {
      if (!hasPortfolio || Object.keys(cleanUpdates).some(field => !PORTFOLIO_FIELDS.includes(field))
        || Object.keys(rawBody).some(key => !['updates', 'expectedVersion', 'operationId', 'accountEmail'].includes(key))
        || !Number.isSafeInteger(rawBody.expectedVersion) || rawBody.expectedVersion < 0
        || typeof rawBody.operationId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(rawBody.operationId)) {
        return NextResponse.json({ success: false, error: 'Invalid portfolio save request.' }, { status: 400 });
      }
      if (rawBody.accountEmail?.toLowerCase() !== email) {
        return NextResponse.json({ success: false, error: 'Sign in to the account that owns these changes.' }, { status: 403 });
      }
    }

    try {
      await connectToDatabase();
    } catch (dbErr) {
      return NextResponse.json({ success: false, error: 'Database service unavailable. Changes were not saved to your account.' }, { status: 503 });
    }

    if (isVersioned) {
      const result = await commitPortfolioSave(User, email, cleanUpdates, rawBody.expectedVersion, rawBody.operationId);
      return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
    }

    // Enforce database schema validators and prevent password exposure
    const updatedUser = await User.findOneAndUpdate(
      { email },
      { $set: cleanUpdates },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return NextResponse.json(
        { success: false, error: 'User account not found. Cannot update profile.' },
        { status: 404 }
      );
    }

    // Deliberately construct response containing only supported profile fields
    const holdings = updatedUser.holdings instanceof Map
      ? Object.fromEntries(updatedUser.holdings)
      : (updatedUser.holdings || {});
    const thresholds = updatedUser.thresholds instanceof Map
      ? Object.fromEntries(updatedUser.thresholds)
      : (updatedUser.thresholds || {});
    const portfolioRiskRules = updatedUser.portfolioRiskRules instanceof Map
      ? Object.fromEntries(updatedUser.portfolioRiskRules)
      : (updatedUser.portfolioRiskRules || {});

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        watchlist: updatedUser.watchlist || [],
        customTickers: updatedUser.customTickers || [],
        holdings,
        thresholds,
        portfolioTransactions: updatedUser.portfolioTransactions || [],
        portfolioCash: updatedUser.portfolioCash ?? 100000,
        portfolioEquityHistory: updatedUser.portfolioEquityHistory || [],
        portfolioRiskRules,
        savedFilters: updatedUser.savedFilters || [],
        watchlistGroups: updatedUser.watchlistGroups || [],
      },
    });
  } catch (error: any) {
    logger.error('[Profile POST Error]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update profile data. Your changes remain pending.' },
      { status: 500 }
    );
  }
}
