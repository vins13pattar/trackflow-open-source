import * as Location from 'expo-location';
import { api } from './api';
import { OfflineQueue, type QueuedReport } from './offline-queue';

export interface TrackingHandle {
  stop: () => void;
}

export interface TrackingUpdate {
  latitude: number;
  longitude: number;
  speedKph: number;
  count: number;
  queued: number;
}

/**
 * Watches the device's location and reports each fix to the API. When the
 * network call fails the fix is appended to a persistent offline queue; on
 * the next successful send we drain pending fixes in chronological order.
 *
 * Foreground tracking; background tracking would add expo-task-manager + a
 * background location task (a future enhancement that needs RN hardware).
 */
export async function startTracking(
  deviceId: string,
  onUpdate: (update: TrackingUpdate) => void,
  queue: OfflineQueue = new OfflineQueue(),
): Promise<TrackingHandle> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission denied');

  let count = 0;
  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
    async (loc) => {
      const fix: QueuedReport = {
        deviceId,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        speedKph: Math.max(0, (loc.coords.speed ?? 0) * 3.6),
        course: loc.coords.heading ?? 0,
        timestamp: loc.timestamp,
      };
      try {
        await api.reportPosition(fix.deviceId, fix);
        count += 1;
        // Online — drain any backlog FIFO so trip distances stay accurate.
        const { sent } = await queue.flush((r) => api.reportPosition(r.deviceId, r).then(() => undefined));
        count += sent;
        const remaining = await queue.size();
        onUpdate({ latitude: fix.latitude, longitude: fix.longitude, speedKph: fix.speedKph, count, queued: remaining });
      } catch {
        // Offline / transient error — persist the fix and surface the queue depth.
        await queue.enqueue(fix);
        const remaining = await queue.size();
        onUpdate({ latitude: fix.latitude, longitude: fix.longitude, speedKph: fix.speedKph, count, queued: remaining });
      }
    },
  );
  return { stop: () => subscription.remove() };
}
