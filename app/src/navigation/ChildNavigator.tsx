import type { ComponentType } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { DailyUsageState, Policy } from '@guardian/domain';
import PairDeviceScreen from '../screens/child/PairDeviceScreen';
import PermissionsDisclosureScreen from '../child/onboarding/PermissionsDisclosureScreen';
import ChildDashboardScreen from '../child/dashboard/ChildDashboardScreen';
import RequestScreen from '../child/dashboard/RequestScreen';
import type { DeviceIdentity } from '../child/dashboard/useLocalBucketEngine';

export type ChildStackParamList = Record<string, object | undefined> & {
  // T28: shown first (see initialRouteName below) — Play policy requires a prominent disclosure
  // of Accessibility/VpnService/Device Admin/Camera use before those permissions are requested.
  PermissionsDisclosure: undefined;
  PairDevice: undefined;
  // T21: real content built (see app/src/child/dashboard/) — route params, not a live "fetch my
  // policy" wiring, carry the fixture/paired state in, same "real and tested, not yet reachable
  // from a built navigation flow" precedent ParentNavigator's T13 screens established (no ticket
  // yet wires PairDeviceScreen's real pairing result into `navigation.navigate('Dashboard', ...)`
  // — flagged in LEDGER.md).
  Dashboard: { policy: Policy; initialUsage: DailyUsageState; categoryId: string; identity: DeviceIdentity };
  // `currentDailyUsage` is only required to build an `extra_time` request's payload (see T19's
  // `ExtraTimeRequestPayload` — the requesting device supplies its own current usage snapshot,
  // there is no backend `daily_usage` table); optional so navigating here to request an unblock
  // or schedule change doesn't need it.
  Request: { identity: DeviceIdentity; currentDailyUsage?: DailyUsageState };
};

interface ScreenConfig {
  name: string;
  component: ComponentType;
}

// Append pattern for T21+: add your screen's entry to this array (name + component), do NOT
// add <Stack.Screen> JSX directly into ChildNavigator below — same convention as
// ParentNavigator.tsx (see its comment for the full rationale/example).
export const childScreens: ScreenConfig[] = [
  { name: 'PermissionsDisclosure', component: PermissionsDisclosureScreen as ComponentType },
  { name: 'PairDevice', component: PairDeviceScreen },
  { name: 'Dashboard', component: ChildDashboardScreen as ComponentType },
  { name: 'Request', component: RequestScreen as ComponentType },
];

const Stack = createNativeStackNavigator<ChildStackParamList>();

export function ChildNavigator() {
  return (
    <Stack.Navigator initialRouteName="PermissionsDisclosure">
      {childScreens.map(({ name, component }) => (
        <Stack.Screen key={name} name={name} component={component} />
      ))}
    </Stack.Navigator>
  );
}
