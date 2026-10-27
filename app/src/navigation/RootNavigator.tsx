import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { ParentNavigator } from './ParentNavigator';
import { ChildNavigator } from './ChildNavigator';
import RoleSelectionScreen from '../screens/RoleSelectionScreen';

export type Role = 'parent' | 'child';

const ROLE_STORAGE_KEY = 'guardian.role';

// On first launch (no persisted role), shows role-selection. Once a role is chosen it's
// persisted to AsyncStorage so subsequent launches skip straight to ParentNavigator/
// ChildNavigator — same "swap the navigator tree based on app state" pattern React Navigation's
// own auth-flow guide recommends, not a from-scratch router.
export function RootNavigator() {
  const [role, setRole] = useState<Role | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ROLE_STORAGE_KEY)
      .then(stored => {
        if (cancelled) return;
        if (stored === 'parent' || stored === 'child') setRole(stored);
      })
      .catch(err => {
        // Read failure falls back to role-selection (safe default) rather than crashing or
        // hanging on the loading spinner — but must still be caught, not left as an unhandled
        // rejection (reviewer-caught: previously had no .catch at all).
        if (!cancelled) console.warn('Failed to read persisted role from AsyncStorage', err);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectRole = useCallback((next: Role) => {
    setRole(next);
    AsyncStorage.setItem(ROLE_STORAGE_KEY, next).catch(err => {
      console.warn('Failed to persist selected role to AsyncStorage', err);
    });
  }, []);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {role === 'parent' ? (
        <ParentNavigator />
      ) : role === 'child' ? (
        <ChildNavigator />
      ) : (
        <RoleSelectionScreen onSelectRole={selectRole} />
      )}
    </NavigationContainer>
  );
}
