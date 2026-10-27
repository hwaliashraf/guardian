import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { StartSessionRefusalReason } from '@guardian/domain';
import type { ChildStackParamList } from '../../navigation/ChildNavigator';
import { useLocalBucketEngine } from './useLocalBucketEngine';
import StillWatchingPrompt from './StillWatchingPrompt';

const BLOCKED_REASON_LABEL: Record<StartSessionRefusalReason, string> = {
  daily_limit_exhausted: "Today's screen time is all used up.",
  weekly_limit_exhausted: "This week's screen time is all used up.",
  session_count_cap_reached: 'No more turns allowed today for this.',
  mandatory_break_active: 'On a break',
  outside_allowed_window: 'Not available right now',
};

type Props = NativeStackScreenProps<ChildStackParamList, 'Dashboard'>;

/**
 * Spec §5's child transparency screen: time left today, current session remaining, next break
 * length, and the active/upcoming schedule window in plain language — all driven by
 * `useLocalBucketEngine`'s JS-side tick of T03/T04/T05's pure engines (see that file's doc
 * comment for the full wiring + caller-contract notes).
 */
export default function ChildDashboardScreen({ route, navigation }: Props) {
  const { policy, initialUsage, categoryId, identity } = route.params;
  const engine = useLocalBucketEngine(policy, initialUsage, categoryId, identity);

  return (
    <View style={styles.root} onTouchStart={engine.recordActivity} testID="child-dashboard-root">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Today</Text>
        <Text testID="remaining-today" style={styles.stat}>
          Time left today: {Math.floor(engine.remainingMinutesToday)} min
        </Text>

        {engine.session ? (
          <Text testID="remaining-session" style={styles.stat}>
            Session remaining: {Math.ceil(engine.remainingSessionMinutes)} min
          </Text>
        ) : (
          <Text testID="blocked-reason" style={styles.stat}>
            {engine.blockedReason === 'mandatory_break_active' && engine.remainingBreakMinutes !== undefined
              ? `${BLOCKED_REASON_LABEL.mandatory_break_active} — ${Math.ceil(engine.remainingBreakMinutes)} min left`
              : engine.blockedReason
                ? BLOCKED_REASON_LABEL[engine.blockedReason]
                : 'Starting session…'}
          </Text>
        )}

        <Text testID="next-break" style={styles.stat}>
          Next break: {engine.nextBreakMinutes} min
        </Text>

        {engine.scheduleMessage ? (
          <Text testID="schedule-message" style={styles.helpText}>
            {engine.scheduleMessage}
          </Text>
        ) : null}

        {engine.show5MinWarning && !engine.show1MinWarning ? (
          <Text testID="warning-5min" style={styles.warning}>
            5 minutes left
          </Text>
        ) : null}
        {engine.show1MinWarning ? (
          <Text testID="warning-1min" style={styles.warningStrong}>
            1 minute left — time to wrap up!
          </Text>
        ) : null}

        <Text
          testID="make-request-button"
          style={styles.requestLink}
          onPress={() => navigation.navigate('Request', { identity, currentDailyUsage: engine.dailyUsage })}
        >
          Ask for extra time, an unblock, or a schedule change
        </Text>
      </ScrollView>

      <StillWatchingPrompt
        visible={engine.stillWatching.visible}
        secondsRemaining={engine.stillWatching.secondsRemaining}
        onRespond={engine.respondStillWatching}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 10 },
  heading: { fontSize: 20, fontWeight: '700' },
  stat: { fontSize: 16, fontWeight: '600' },
  helpText: { fontSize: 14, color: '#555' },
  warning: { fontSize: 14, color: '#b54708', fontWeight: '600' },
  warningStrong: { fontSize: 14, color: '#d92d20', fontWeight: '700' },
  requestLink: { marginTop: 16, fontSize: 14, color: '#2e6ef7', fontWeight: '600' },
});
