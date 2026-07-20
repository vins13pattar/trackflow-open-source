import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { type AlertDetail, api } from '../lib/api';
import { colors } from '../lib/theme';

interface Props {
  alertId: string;
  onClose: () => void;
}

export function AlertDetailScreen({ alertId, onClose }: Props) {
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    api
      .getAlert(alertId)
      .then(setAlert)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [alertId]);

  async function acknowledge() {
    if (!alert || alert.acknowledged) return;
    setAcking(true);
    try {
      const updated = await api.ackAlert(alert.id);
      setAlert(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAcking(false);
    }
  }

  const severityColor =
    alert?.severity === 'critical' ? colors.danger : alert?.severity === 'warning' ? '#f59e0b' : colors.primary;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.brand}>Alert</Text>
        <Pressable onPress={onClose}>
          <Text style={styles.link}>Close</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : alert ? (
        <View>
          <View style={[styles.pill, { backgroundColor: severityColor }]}>
            <Text style={styles.pillText}>{alert.severity.toUpperCase()}</Text>
          </View>
          <Text style={styles.title}>{alert.title}</Text>
          <Text style={styles.message}>{alert.message}</Text>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Type</Text>
            <Text style={styles.metaValue}>{alert.type}</Text>
            <Text style={styles.metaLabel}>Time</Text>
            <Text style={styles.metaValue}>{new Date(alert.createdAt).toLocaleString()}</Text>
            {alert.lat !== null && alert.lon !== null && (
              <>
                <Text style={styles.metaLabel}>Location</Text>
                <Text style={styles.metaValue}>
                  {alert.lat.toFixed(5)}, {alert.lon.toFixed(5)}
                </Text>
              </>
            )}
          </View>
          {!alert.acknowledged && (
            <Pressable style={styles.ackButton} onPress={acknowledge} disabled={acking}>
              <Text style={styles.ackText}>{acking ? 'Acknowledging…' : 'Acknowledge'}</Text>
            </Pressable>
          )}
          {alert.acknowledged && <Text style={styles.acked}>Acknowledged</Text>}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  brand: { color: colors.text, fontSize: 22, fontWeight: '700' },
  link: { color: colors.primary, fontWeight: '600' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginBottom: 12 },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 6 },
  message: { color: colors.text, fontSize: 15, marginBottom: 18 },
  metaCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
  },
  metaLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 2, marginTop: 8 },
  metaValue: { color: colors.text, fontSize: 14, fontWeight: '500' },
  ackButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  ackText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  acked: { color: colors.success, textAlign: 'center', marginTop: 8 },
  error: { color: colors.danger, marginTop: 20, textAlign: 'center' },
});
