import type { ComponentType } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/parent/LoginScreen';
import DashboardScreen from '../parent/dashboard/DashboardScreen';
import ScreenTimeScreen from '../parent/policy/ScreenTimeScreen';
import SchedulesScreen from '../parent/policy/SchedulesScreen';
import VacationModeScreen from '../parent/policy/VacationModeScreen';
import BucketsScreen from '../parent/buckets/BucketsScreen';
import ContentFilterScreen from '../parent/contentFilter/ContentFilterScreen';
import AppManagementScreen from '../parent/appManagement/AppManagementScreen';
import InstallAlertsScreen from '../parent/appManagement/InstallAlertsScreen';
import FamilyMapScreen from '../parent/location/FamilyMapScreen';
import GeofenceEditorScreen from '../parent/location/GeofenceEditorScreen';
import LocationHistoryScreen from '../parent/location/LocationHistoryScreen';
import ActivityTimelineScreen from '../parent/reports/ActivityTimelineScreen';
import YouTubeHistoryScreen from '../parent/reports/YouTubeHistoryScreen';
import WeeklyDigestScreen from '../parent/reports/WeeklyDigestScreen';
import RequestsInboxScreen from '../parent/requests/RequestsInboxScreen';
import TamperAlertsScreen from '../parent/tamper/TamperAlertsScreen';
import PaywallScreen from '../parent/billing/PaywallScreen';

export type ParentStackParamList = Record<string, object | undefined> & {
  Login: undefined;
  Dashboard: undefined;
  ScreenTime: { childId: string };
  Schedules: { childId: string };
  VacationMode: { childId: string };
  Buckets: { childId: string };
  ContentFilter: { childId: string };
  AppManagement: { childId: string };
  InstallAlerts: { childId: string };
  FamilyMap: undefined;
  GeofenceEditor: { childId: string };
  LocationHistory: { childId: string };
  ActivityTimeline: { childId: string };
  YouTubeHistory: { childId: string };
  WeeklyDigest: { childId: string };
  RequestsInbox: undefined;
  TamperAlerts: { childId: string };
  // T20: real screen now registered below (was a type-only forward declaration since T14 —
  // BucketsScreen/AppManagementScreen/FamilyMapScreen's upsell CTAs already called
  // `navigation.navigate('Paywall')` and now resolve for real, no changes needed on their side).
  Paywall: undefined;
};

interface ScreenConfig {
  name: string;
  component: ComponentType;
}

// Append pattern for T12+: add your screen's entry to this array (name + component), do NOT
// add <Stack.Screen> JSX directly into ParentNavigator below — this array is the single source
// of truth the navigator renders from, so later tickets never touch the <Stack.Navigator> JSX.
// Example:
//   parentScreens.push({ name: 'Settings', component: SettingsScreen });
// Also extend `ParentStackParamList` above with the new route's param type.
export const parentScreens: ScreenConfig[] = [
  { name: 'Login', component: LoginScreen },
  { name: 'Dashboard', component: DashboardScreen },
  { name: 'ScreenTime', component: ScreenTimeScreen as ComponentType },
  { name: 'Schedules', component: SchedulesScreen as ComponentType },
  { name: 'VacationMode', component: VacationModeScreen as ComponentType },
  { name: 'Buckets', component: BucketsScreen as ComponentType },
  { name: 'ContentFilter', component: ContentFilterScreen as ComponentType },
  { name: 'AppManagement', component: AppManagementScreen as ComponentType },
  { name: 'InstallAlerts', component: InstallAlertsScreen as ComponentType },
  { name: 'FamilyMap', component: FamilyMapScreen as ComponentType },
  { name: 'GeofenceEditor', component: GeofenceEditorScreen as ComponentType },
  { name: 'LocationHistory', component: LocationHistoryScreen as ComponentType },
  { name: 'ActivityTimeline', component: ActivityTimelineScreen as ComponentType },
  { name: 'YouTubeHistory', component: YouTubeHistoryScreen as ComponentType },
  { name: 'WeeklyDigest', component: WeeklyDigestScreen as ComponentType },
  { name: 'RequestsInbox', component: RequestsInboxScreen },
  { name: 'TamperAlerts', component: TamperAlertsScreen as ComponentType },
  { name: 'Paywall', component: PaywallScreen },
];

const Stack = createNativeStackNavigator<ParentStackParamList>();

export function ParentNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login">
      {parentScreens.map(({ name, component }) => (
        <Stack.Screen key={name} name={name} component={component} />
      ))}
    </Stack.Navigator>
  );
}
