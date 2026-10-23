import type { FrameworkId } from './framework-types';

export const FRAMEWORK_RULE_VERSION = 'axion-eod-v1';
export const FRAMEWORK_SOURCES = {
  rsi: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi',
  atr: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-true-range-atr',
  relativeStrength: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/price-relative-relative-strength',
};
export const FRAMEWORK_REGISTRY: Record<FrameworkId, {
  name: string; version: string; validation: 'untested'; attribution: 'axion-adaptation';
  sourceUrls: string[]; minimumDailyBars: number;
}> = {
  'momentum-rs55': {
    name: 'Relative-strength momentum', version: FRAMEWORK_RULE_VERSION,
    validation: 'untested', attribution: 'axion-adaptation',
    sourceUrls: [FRAMEWORK_SOURCES.relativeStrength, FRAMEWORK_SOURCES.rsi, FRAMEWORK_SOURCES.atr], minimumDailyBars: 200,
  },
  'sma44-pullback': {
    name: '44 SMA pullback', version: FRAMEWORK_RULE_VERSION,
    validation: 'untested', attribution: 'axion-adaptation', sourceUrls: [], minimumDailyBars: 49,
  },
};

export const FRAMEWORK_IDS = Object.keys(FRAMEWORK_REGISTRY) as FrameworkId[];
