import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChildStackParamList } from '../../navigation/ChildNavigator';

type Props = NativeStackScreenProps<ChildStackParamList, 'PermissionsDisclosure'>;

interface PermissionDisclosure {
  id: string;
  title: string;
  body: string;
}

// Copy sourced from docs/compliance/play-store-disclosure.md's "In-app disclosure screen copy"
// section (T28) — keep these two in sync by hand if either changes; the doc is what Google Play
// reviewers see, this is what the child/parent actually sees on-device, and they must match.
// One entry per T22-T25 permission this screen discloses (matching the `// see T28` markers
// left in AndroidManifest.xml/strings.xml by those tickets).
const DISCLOSURES: PermissionDisclosure[] = [
  {
    id: 'accessibility',
    title: 'Accessibility Service',
    body: "Guardian uses Android's Accessibility Service to see what app is currently on-screen and to scan on-screen text for content-filtering purposes (for example, detecting a blocked search term). This is not a general accessibility tool — Guardian does not read passwords or private-messaging content through this permission.",
  },
  {
    id: 'vpn',
    title: 'Local VPN (content filter)',
    body: 'Guardian runs a local, on-device VPN — not to route your traffic through any external server, but to filter which websites this device can reach, based on the content categories a parent has configured. This VPN does not send your browsing traffic anywhere outside this device beyond ordinary DNS resolution through a filtering resolver.',
  },
  {
    id: 'deviceAdmin',
    title: 'Device Administrator',
    body: "Guardian requests Device Administrator access so a child cannot simply uninstall the app to bypass parental controls. With this permission active, uninstalling Guardian requires the parent's own approval, or removing Device Admin access first — which is itself logged and reported to the parent.",
  },
  {
    id: 'camera',
    title: 'Camera (presence detection)',
    body: "Guardian can optionally use the front camera to help tell whether you're actually present and paying attention. This is off by default and requires a separate opt-in. Guardian never saves, stores, or sends any camera image or video — it only keeps a yes/no \"was a face detected\" result for a moment, then discards the frame.",
  },
];

/**
 * Spec §8 / Google Play policy: Accessibility, VpnService, Device Admin, and background-camera
 * usage each require a "prominent disclosure screen and policy justification" shown before the
 * corresponding permission is requested (T22/T23/T24/T25 left `// see T28` markers in
 * `AndroidManifest.xml`/`strings.xml` pointing at this copy). This screen is that disclosure —
 * shown once, up front, for all four features at once (a family only needs to see this once
 * during onboarding, not once per feature as each is separately requested).
 *
 * **Not yet wired to a real permission-request flow**: no ticket has built the actual JS-side
 * calls into `VpnModule`/`AccessibilityModule`/`UsageModule`/`PresenceModule` that would request
 * each permission (confirmed by grep — none exist in `app/src` yet); `PairDeviceScreen.tsx`
 * itself remains T11's unbuilt stub. This screen is real, tested, and positioned first in
 * `ChildNavigator`'s stack (`initialRouteName`) so it is shown before wherever those requests
 * eventually happen — same "real, tested, but not yet reachable from a built end-to-end flow"
 * precedent T13/T21/T25 already established. "Continue" navigates to `PairDevice`.
 */
export default function PermissionsDisclosureScreen({ navigation }: Props) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Before you continue</Text>
      <Text style={styles.intro}>
        Guardian uses a few special Android permissions to keep this device safe. Here's exactly what each one does.
      </Text>
      {DISCLOSURES.map(item => (
        <View key={item.id} testID={`disclosure-${item.id}`} style={styles.card}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardBody}>{item.body}</Text>
        </View>
      ))}
      <Pressable testID="disclosure-continue" style={styles.continueButton} onPress={() => navigation.navigate('PairDevice')}>
        <Text style={styles.continueButtonText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  heading: { fontSize: 22, fontWeight: '700' },
  intro: { fontSize: 14, color: '#444' },
  card: { backgroundColor: '#f4f6fb', borderRadius: 12, padding: 16, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardBody: { fontSize: 13, color: '#333', lineHeight: 18 },
  continueButton: { backgroundColor: '#2e6ef7', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  continueButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
