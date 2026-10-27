import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface StillWatchingPromptProps {
  visible: boolean;
  secondsRemaining: number;
  onRespond: () => void;
}

/**
 * Level-0 presence check UI (spec §6): shown when `useLocalBucketEngine` detects idle time past
 * `policy.presence.thresholdMinutes.level0` on video-like content. Tapping "Yes" (or any other
 * screen touch, wired via `recordActivity`) resets the idle clock; letting the 30-second
 * countdown reach zero is what feeds `stillPromptTimedOut: true` into `evaluatePresence` on the
 * hook's next tick (see `useLocalBucketEngine.ts`) — this component has no timer of its own, it
 * only renders whatever countdown state the hook already owns.
 */
export default function StillWatchingPrompt({ visible, secondsRemaining, onRespond }: StillWatchingPromptProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" testID="still-watching-modal">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Still watching?</Text>
          <Text style={styles.body}>Respond within {secondsRemaining}s or this session pauses.</Text>
          <Pressable testID="still-watching-yes" style={styles.yesButton} onPress={onRespond}>
            <Text style={styles.yesButtonText}>Yes, I'm here</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 12, width: '80%' },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 14, color: '#444' },
  yesButton: { backgroundColor: '#2e6ef7', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  yesButtonText: { color: '#fff', fontWeight: '600' },
});
