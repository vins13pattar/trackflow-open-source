import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type DeviceSummary, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { registerForPush } from '../lib/push';
import { colors } from '../lib/theme';
import { type TrackingHandle, type TrackingUpdate, startTracking } from '../lib/tracking';

export function HomeScreen() {
  const { user, logout } = useAuth();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [last, setLast] = useState<TrackingUpdate | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<TrackingHandle | null>(null);

  useEffect(() => {
    api
      .listDevices()
      .then((r) => {
        setDevices(r.devices);
        if (r.devices[0]) setSelectedId(r.devices[0].id);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    void registerForPush().then(async (token) => {
      setPushToken(token);
      if (token) {
        try {
          await api.registerPush(token, Platform.OS);
        } catch {
          // non-fatal: alerts still arrive via in-app SSE
        }
      }
    });
    return () => handle.current?.stop();
  }, []);

  const toggle = async () => {
    setError(null);
    if (tracking) {
      handle.current?.stop();
      handle.current = null;
      setTracking(false);
      return;
    }
    if (!selectedId) {
      setError('Select a device to report as.');
      return;
    }
    try {
      handle.current = await startTracking(selectedId, setLast);
      setTracking(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>TrackFlow</Text>
          <Text style={styles.muted}>{user?.name ?? user?.email ?? 'Signed in'}</Text>
        </View>
        <Pressable onPress={logout}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Report as device</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
      ) : devices.length === 0 ? (
        <Text style={styles.muted}>No devices. Create one in the web dashboard first.</Text>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => d.id}
          style={{ maxHeight: 220 }}
          renderItem={({ item }) => {
            const active = item.id === selectedId;
            return (
              <Pressable
                onPress={() => !tracking && setSelectedId(item.id)}
                style={[styles.device, active && styles.deviceActive]}
              >
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.muted}>{item.imei}</Text>
              </Pressable>
            );
          }}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: tracking ? colors.success : colors.muted }]} />
          <Text style={styles.statusText}>{tracking ? 'Tracking — reporting live' : 'Not tracking'}</Text>
        </View>
        {last ? (
          <Text style={styles.muted}>
            {last.latitude.toFixed(5)}, {last.longitude.toFixed(5)} · {Math.round(last.speedKph)} km/h ·{' '}
            {last.count} sent
          </Text>
        ) : (
          <Text style={styles.muted}>No fixes reported yet.</Text>
        )}
      </View>

      <Pressable
        style={[styles.button, tracking ? styles.stop : styles.start]}
        onPress={toggle}
        disabled={!selectedId && !tracking}
      >
        <Text style={styles.buttonText}>{tracking ? 'Stop tracking' : 'Start tracking'}</Text>
      </Pressable>

      {pushToken ? <Text style={styles.push}>Push registered ✓</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  brand: { color: colors.text, fontSize: 22, fontWeight: '700' },
  link: { color: colors.primary, fontWeight: '600' },
  label: { color: colors.text, fontWeight: '600', marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13 },
  device: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  deviceActive: { borderColor: colors.primary },
  deviceName: { color: colors.text, fontWeight: '600' },
  statusCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { color: colors.text, fontWeight: '600' },
  button: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  start: { backgroundColor: colors.primary },
  stop: { backgroundColor: colors.danger },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, marginTop: 12 },
  push: { color: colors.muted, textAlign: 'center', marginTop: 14, fontSize: 12 },
});
