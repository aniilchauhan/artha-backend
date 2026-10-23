const appBasePath = (process.env.NEXT_PUBLIC_AXION_BASE_PATH ?? '').replace(/\/$/, '');

export function axionAppPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || !appBasePath ||
      path === appBasePath || path.startsWith(`${appBasePath}/`) || path.startsWith(`${appBasePath}?`)) {
    return path;
  }
  return `${appBasePath}${path === '/' ? '' : path}`;
}

export function axionLocalPath(path: string): string {
  if (appBasePath && (path === appBasePath || path.startsWith(`${appBasePath}/`))) {
    return path.slice(appBasePath.length) || '/';
  }
  return path;
}

export function axionApiPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return axionAppPath(normalizedPath);
}

export function axionAssetPath(path: string): string {
  if (!appBasePath || !path.startsWith('/') || path.startsWith('//') || path.startsWith(`${appBasePath}/`)) return path;
  return `${appBasePath}/assets${path}`;
}

/** Keep requests local to the embedded workspace without changing standalone URLs. */
export function axionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = typeof input === 'string' && input.startsWith('/api/') ? axionApiPath(input)
    : typeof input === 'string' && input === '/all_indian_stocks_5055.json' ? axionAssetPath(input)
    : input;
  return globalThis.fetch(target, init);
}
