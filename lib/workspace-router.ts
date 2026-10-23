'use client';

import { useMemo } from 'react';
import { usePathname as useNextPathname, useRouter as useNextRouter } from 'next/navigation';
import { axionAppPath, axionLocalPath } from './in-process';

export { useSearchParams, useParams } from 'next/navigation';

export function usePathname() {
  const pathname = useNextPathname();
  return pathname ? axionLocalPath(pathname) : pathname;
}

export function useRouter() {
  const router = useNextRouter();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(axionAppPath(href), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(axionAppPath(href), options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(axionAppPath(href), options),
  }), [router]);
}
