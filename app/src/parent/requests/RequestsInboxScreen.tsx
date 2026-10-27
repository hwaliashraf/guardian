import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChildRequest } from '@guardian/domain';
import { useRequests } from './useRequests';

const REQUEST_TYPE_LABEL: Record<ChildRequest['type'], string> = {
  extra_time: 'Extra time',
  unblock: 'Unblock',
  schedule_change: 'Schedule change',
};

export default function RequestsInboxScreen() {
  const { pending, resolved, loading, error, resolving, resolveError, resolve, extraTimeGrants } = useRequests();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Pending</Text>
      {pending.length === 0 ? <Text>No pending requests.</Text> : null}
      {pending.map((request) => (
        <View key={request.id} testID={`request-${request.id}`} style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.requestType}>{REQUEST_TYPE_LABEL[request.type]}</Text>
            <Text style={styles.helpText}>{new Date(request.createdAt).toLocaleString()}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              testID={`request-${request.id}-approve`}
              style={styles.approveButton}
              onPress={() => {
                resolve(request.id, true).catch(() => {});
              }}
              disabled={resolving}
            >
              <Text style={styles.actionButtonText}>Approve</Text>
            </Pressable>
            <Pressable
              testID={`request-${request.id}-deny`}
              style={styles.denyButton}
              onPress={() => {
                resolve(request.id, false).catch(() => {});
              }}
              disabled={resolving}
            >
              <Text style={styles.actionButtonText}>Deny</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {resolveError ? <Text style={styles.errorText}>{resolveError}</Text> : null}

      <Text style={styles.sectionTitle}>History</Text>
      {resolved.length === 0 ? <Text>No resolved requests yet.</Text> : null}
      {resolved.map((request) => {
        const grant = extraTimeGrants[request.id];
        const categoryId = typeof request.payload.categoryId === 'string' ? request.payload.categoryId : null;
        return (
          <View key={request.id} testID={`request-history-${request.id}`} style={styles.historyCard}>
            <Text style={styles.requestType}>{REQUEST_TYPE_LABEL[request.type]}</Text>
            <Text style={styles.helpText}>
              {request.status === 'approved' ? 'Approved' : 'Denied'}
              {request.resolvedAt ? ` · ${new Date(request.resolvedAt).toLocaleString()}` : ''}
            </Text>
            {/* Consumes T19's buildExtraTimeGrant result — the one place the computed grant is
                surfaced (no backend daily_usage table; see useRequests.ts's extraTimeGrants doc). */}
            {grant && categoryId ? (
              <Text style={styles.helpText}>
                {categoryId}: {grant.perCategoryMinutesUsed[categoryId] ?? 0} min used today after grant
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 12 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', gap: 8 },
  historyCard: { padding: 12, borderRadius: 8, backgroundColor: '#f8f8f8', gap: 2 },
  fieldGroup: { gap: 2, flex: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  requestType: { fontSize: 14, fontWeight: '600' },
  helpText: { fontSize: 13, color: '#555' },
  approveButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#12b76a' },
  denyButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#d92d20' },
  actionButtonText: { color: '#fff', fontWeight: '600' },
  errorText: { color: '#d92d20' },
});
