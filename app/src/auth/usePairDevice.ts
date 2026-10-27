import { useCallback, useState } from 'react';
import { SUPABASE_ANON_KEY } from '@env';
import { FUNCTIONS_URL } from '../supabaseClient';
import { validatePairingCode } from './validation';

export type DevicePlatform = 'android' | 'ios';

interface PairDeviceResult {
  deviceId: string;
  childId: string;
  deviceToken: string;
  deviceTokenExpiresAt: string;
}

interface UsePairDevice {
  pairDevice: (platform: DevicePlatform, deviceName: string) => Promise<PairDeviceResult>;
  loading: boolean;
  error: string | null;
}

// Calls T10's `POST /auth-flows/pair-device`. `code` is bound at hook-call time (per the
// ticket's literal `usePairDevice(code)` signature) — the caller (PairDeviceScreen) collects the
// 6-digit code from the child-device UI before invoking `pairDevice`.
export function usePairDevice(code: string): UsePairDevice {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pairDevice = useCallback(
    async (platform: DevicePlatform, deviceName: string): Promise<PairDeviceResult> => {
      const codeError = validatePairingCode(code);
      if (codeError) {
        setError(codeError);
        throw new Error(codeError);
      }
      if (!deviceName.trim()) {
        const message = 'Device name is required';
        setError(message);
        throw new Error(message);
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${FUNCTIONS_URL}/auth-flows/pair-device`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ code: code.trim(), platform, deviceName }),
        });
        const body = (await res.json()) as PairDeviceResult | { error: string };
        if (!res.ok) {
          const message = 'error' in body ? body.error : 'Pairing failed';
          setError(message);
          throw new Error(message);
        }
        return body as PairDeviceResult;
      } finally {
        setLoading(false);
      }
    },
    [code],
  );

  return { pairDevice, loading, error };
}
