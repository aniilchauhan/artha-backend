/**
 * Web Audio Synthesizer, PWA Service Worker Push, and Web Notification Dispatcher
 * Provides zero-asset synthesized audio alerts (Target Hit, Stop Loss, 100% Gap Fill)
 * and background service worker notifications with device vibration.
 */

import { isNSEMarketOpen } from './market-hours';

export function isAudioSupported(): boolean {
  return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isServiceWorkerSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Registers PWA service worker for background sync and push alerts.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.warn('[PWA] Service worker registration failed:', err);
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Dispatches gap notification via active Service Worker (for background capability & vibration)
 * or falls back to browser Notification API.
 */
export function sendGapNotification(title: string, body: string, tag = 'gap-alert', force = false): boolean {
  if (!force && !isNSEMarketOpen()) {
    return false;
  }
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  // Attempt background Service Worker notification first if registered
  if (isServiceWorkerSupported() && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag,
        data: '/',
      });
    }).catch(() => {
      // Fallback
      try {
        new Notification(title, { body, icon: '/favicon.ico', tag });
      } catch {}
    });
    return true;
  }

  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays a pleasant ascending two-tone chime for Target Hit / Bullish Drive (D5 -> A5)
 */
export function playTargetChime(): void {
  if (!isAudioSupported()) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch {
    // Audio context may be restricted by browser autoplay policy
  }
}

/**
 * Plays a cautionary descending tone for Stop Loss Hit / Caution (A4 -> Eb4)
 */
export function playStopLossChime(): void {
  if (!isAudioSupported()) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now); // A4
    osc.frequency.exponentialRampToValueAtTime(311.13, now + 0.25); // Eb4

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch {
    // Audio context may be restricted by autoplay policy
  }
}

/**
 * Plays a bright 3-tone harmonic major triad arpeggio for 100% Gap Fill (C5 -> E5 -> G5)
 */
export function playGapFillChime(): void {
  if (!isAudioSupported()) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Arpeggiate C5 (523.25) -> E5 (659.25) -> G5 (783.99)
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.12);
    osc.frequency.setValueAtTime(783.99, now + 0.24);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.65);
  } catch {
    // Audio context may be restricted by autoplay policy
  }
}

/**
 * Dispatches high-priority momentum & 5-minute radar alerts via browser Notification API
 */
export function sendMomentumNotification(title: string, body: string, tag = 'momentum-radar-alert', force = false): boolean {
  if (!force && !isNSEMarketOpen()) {
    return false;
  }
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  try {
    if (isServiceWorkerSupported() && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag,
          data: '/',
        });
      }).catch(() => {
        new Notification(title, { body, icon: '/favicon.ico', tag });
      });
      return true;
    }

    new Notification(title, { body, icon: '/favicon.ico', tag });
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays an energetic 4-tone rapid ascending arpeggio for immediate momentum & breakout discoveries (F5 -> A5 -> C6 -> E6)
 */
export function playMomentumAlertChime(force = false): void {
  if (!force && !isNSEMarketOpen()) return;
  if (!isAudioSupported()) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    // Rapid momentum fanfare: F5 (698.46) -> A5 (880.00) -> C6 (1046.50) -> E6 (1318.51)
    osc.frequency.setValueAtTime(698.46, now);
    osc.frequency.setValueAtTime(880.00, now + 0.08);
    osc.frequency.setValueAtTime(1046.50, now + 0.16);
    osc.frequency.setValueAtTime(1318.51, now + 0.24);

    gain.gain.setValueAtTime(0.20, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch {
    // Audio context may be restricted by autoplay policy
  }
}

