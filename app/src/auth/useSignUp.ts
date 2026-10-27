import { useCallback, useState } from 'react';
import { SUPABASE_ANON_KEY } from '@env';
import { FUNCTIONS_URL } from '../supabaseClient';
import { validateEmail, validatePassword } from './validation';

interface SignUpResult {
  familyId: string;
  parentId: string;
  email: string;
  parentalConsentAcceptedAt: string;
}

interface UseSignUp {
  signUp: (email: string, password: string, familyName?: string) => Promise<SignUpResult>;
  loading: boolean;
  error: string | null;
}

// Calls T10's `POST /auth-flows/signup` (packages/backend/supabase/functions/auth-flows).
// `consentAccepted` is bound at hook-call time (per the ticket's literal `useSignUp(consentAccepted)`
// signature) — the caller (RoleSelection/Login flow) must have already collected consent before
// mounting this hook's usage; the flag is still forwarded on every request since the edge
// function independently re-checks it (never trusts the client alone for the COPPA/GDPR-K gate).
export function useSignUp(consentAccepted: boolean): UseSignUp {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signUp = useCallback(
    async (email: string, password: string, familyName?: string): Promise<SignUpResult> => {
      const emailError = validateEmail(email);
      if (emailError) {
        setError(emailError);
        throw new Error(emailError);
      }
      const passwordError = validatePassword(password);
      if (passwordError) {
        setError(passwordError);
        throw new Error(passwordError);
      }
      if (!consentAccepted) {
        const message = 'Parental consent must be accepted to sign up';
        setError(message);
        throw new Error(message);
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${FUNCTIONS_URL}/auth-flows/signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ email, password, consentAccepted, familyName }),
        });
        const body = (await res.json()) as SignUpResult | { error: string };
        if (!res.ok) {
          const message = 'error' in body ? body.error : 'Sign up failed';
          setError(message);
          throw new Error(message);
        }
        return body as SignUpResult;
      } finally {
        setLoading(false);
      }
    },
    [consentAccepted],
  );

  return { signUp, loading, error };
}
