import { useCallback, useEffect, useState } from 'react';
import type { InstalledApp } from '@guardian/domain';

// No real Android device is paired in this environment (LEDGER Phase 0) — this fixture stands
// in for a device-reported installed-app list. T24 (InstalledAppsModule.kt) is the seam that
// swaps this hook's body for a real query (either a live native-module bridge call or a
// `device_event`-sourced read) without any consumer of `useInstalledApps` needing to change,
// since the returned shape already matches what a real async query would expose.
const FIXTURE_INSTALLED_APPS: InstalledApp[] = [
  { appId: 'com.tiktok.android', name: 'TikTok', storeRating: '12+' },
  { appId: 'com.instagram.android', name: 'Instagram', storeRating: '12+' },
  { appId: 'com.discord', name: 'Discord', storeRating: '17+' },
  { appId: 'com.mojang.minecraftpe', name: 'Minecraft', storeRating: '9+' },
  { appId: 'com.roblox.client', name: 'Roblox', storeRating: '9+' },
  { appId: 'com.google.android.youtube', name: 'YouTube', storeRating: '12+' },
  { appId: 'com.duolingo', name: 'Duolingo', storeRating: '4+' },
];

interface UseInstalledApps {
  apps: InstalledApp[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useInstalledApps(childId: string): UseInstalledApps {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApps(FIXTURE_INSTALLED_APPS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load installed apps');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchApps();
  }, [fetchApps]);

  return { apps, loading, error, refetch: fetchApps };
}
