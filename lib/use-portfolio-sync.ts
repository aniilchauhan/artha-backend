'use client';


import { axionFetch as fetch } from './in-process';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortfolioSync, type PortfolioPatch, type PortfolioSyncState } from './portfolio-sync';

const signedOut: PortfolioSyncState = { status: 'signed-out', message: 'Sign in to save portfolio changes.', profile: null, pending: false };

export function usePortfolioSync(email: string | null) {
  const currentEmail = useRef(email);
  currentEmail.current = email;
  const client = useRef<PortfolioSync | null>(null);
  const [result, setResult] = useState<{ email: string | null; state: PortfolioSyncState }>({ email: null, state: signedOut });
  useEffect(() => {
    if (!email) { setResult({ email: null, state: signedOut }); return; }
    const instance = new PortfolioSync(email, {
      getItem: key => sessionStorage.getItem(key),
      setItem: (key, value) => sessionStorage.setItem(key, value),
    }, state => {
      if (currentEmail.current !== email) return;
      setResult({ email, state });
      if (state.status === 'saved') {
        // The server acknowledged this state (or the user explicitly chose account data).
        try {
          for (const suffix of ['portfolio_holdings', 'portfolio_holdings_pending', 'portfolio_cash', 'portfolio_transactions', 'portfolio_risk_rules', 'portfolio_equity_history']) localStorage.removeItem(`axion_${email}_${suffix}`);
        } catch { /* The new queue remains authoritative; old recovery copies may remain. */ }
      }
    }, fetch, () => crypto.randomUUID(), () => {
      const patch: Record<string, unknown> = {};
      for (const [field, suffix] of Object.entries({ holdings: 'portfolio_holdings', portfolioCash: 'portfolio_cash', portfolioTransactions: 'portfolio_transactions', portfolioRiskRules: 'portfolio_risk_rules', portfolioEquityHistory: 'portfolio_equity_history' })) {
        const value = localStorage.getItem(`axion_${email}_${suffix}`);
        if (value !== null) patch[field] = JSON.parse(value);
      }
      return Object.keys(patch).length ? patch as PortfolioPatch : null;
    });
    client.current = instance;
    setResult({ email, state: instance.state });
    void instance.start();
    const online = () => { if (instance.state.status === 'pending') instance.retry(); };
    const leaving = (event: BeforeUnloadEvent) => {
      if (instance.state.pending) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', leaving);
    return () => { instance.dispose(); if (client.current === instance) client.current = null; window.removeEventListener('online', online); window.removeEventListener('beforeunload', leaving); };
  }, [email]);

  const ownClient = useCallback(() => client.current?.accountEmail === currentEmail.current ? client.current : null, []);
  const savePortfolio = useCallback((patch: PortfolioPatch) => email === currentEmail.current && (ownClient()?.enqueue(patch) ?? false), [email, ownClient]);
  const retryPortfolioSave = useCallback(() => ownClient()?.retry(), [ownClient]);
  const useSavedPortfolio = useCallback(() => { void ownClient()?.useAccountData(); }, [ownClient]);
  const downloadPendingPortfolio = useCallback(() => {
    const instance = ownClient();
    if (!instance) return;
    const legacy: Record<string, string | null> = {};
    try {
      for (const suffix of ['portfolio_holdings', 'portfolio_cash', 'portfolio_transactions', 'portfolio_risk_rules', 'portfolio_equity_history']) {
        legacy[suffix] = localStorage.getItem(`axion_${instance.accountEmail}_${suffix}`);
      }
    } catch { /* Queue and in-memory changes can still be downloaded. */ }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ pending: JSON.parse(instance.exportPending()), legacy }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'axion-pending-portfolio.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [ownClient]);
  const portfolioSync = result.email === email ? result.state : { ...signedOut, status: email ? 'loading' as const : 'signed-out' as const, message: email ? 'Loading saved portfolio…' : signedOut.message };
  return { portfolioSync, savePortfolio, retryPortfolioSave, useSavedPortfolio, downloadPendingPortfolio };
}
