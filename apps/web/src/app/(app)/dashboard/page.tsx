'use client';

import { Gauge, Navigation, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DevicePanel } from '@/components/DevicePanel';
import { LiveMap } from '@/components/LiveMap';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { Telemetry } from '@/components/Telemetry';
import { API_BASE, api, getToken } from '@/lib/api';
import type { DeviceSummary, HistoryPoint, PositionEvent } from '@/lib/types';
import { useTick } from '@/lib/use-tick';
import { formatSpeed, timeAgo } from '@/lib/utils';

export default function DashboardPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [track, setTrack] = useState<[number, number][] | null>(null);
  const [historyPoints, setHistoryPoints] = useState<HistoryPoint[] | null>(null);
  const [playheadIdx, setPlayheadIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selRef = useRef<string | null>(null);
  useTick(); // re-render periodically so stale devices flip to offline

  // Disabled (inactive) devices are hidden from the live view.
  const visibleDevices = devices.filter((d) => d.status !== 'inactive');

  useEffect(() => {
    api
      .listDevices()
      .then((r) => setDevices(r.devices))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${API_BASE}/realtime/positions?token=${encodeURIComponent(token)}`);
    es.addEventListener('position', (ev) => {
      const p = JSON.parse((ev as MessageEvent).data) as PositionEvent;
      setDevices((prev) =>
        prev.map((d) => {
          if (d.id !== p.deviceId) return d;
          const attributes = p.attributes ? { ...(d.attributes ?? {}), ...p.attributes } : d.attributes;
          if (p.kind === 'status') return { ...d, lastSeen: p.fixTime, attributes };
          return {
            ...d,
            lastSeen: p.fixTime,
            lastPosition: { latitude: p.lat, longitude: p.lon, speedKph: p.speedKph, course: p.course, fixTime: p.fixTime },
            attributes,
          };
        }),
      );
      if (selRef.current === p.deviceId && p.kind !== 'status') {
        setTrack((t) => (t ? [...t, [p.lon, p.lat]] : [[p.lon, p.lat]]));
      }
    });
    return () => es.close();
  }, []);

  // Auto-advance playhead when playing.
  useEffect(() => {
    if (!playing) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
      return;
    }
    playIntervalRef.current = setInterval(() => {
      setPlayheadIdx((idx) => {
        if (idx === null || !historyPoints) return idx;
        const next = idx + 1;
        if (next >= historyPoints.length) {
          setPlaying(false);
          return idx;
        }
        return next;
      });
    }, 150);
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [playing, historyPoints]);

  const onSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    selRef.current = id;
    setPlayheadIdx(null);
    setPlaying(false);
    try {
      const now = Date.now();
      const r = await api.history(id, now - 2 * 3600 * 1000, now);
      // API returns newest-first; reverse to oldest-first for chronological playback.
      const ordered = r.points.slice().reverse();
      setTrack(ordered.map((p) => [p.longitude, p.latitude] as [number, number]));
      setHistoryPoints(ordered);
      if (ordered.length > 0) setPlayheadIdx(ordered.length - 1);
    } catch {
      setTrack(null);
      setHistoryPoints(null);
    }
  }, []);

  const clearSelection = () => {
    setSelectedId(null);
    selRef.current = null;
    setTrack(null);
    setHistoryPoints(null);
    setPlayheadIdx(null);
    setPlaying(false);
  };

  const selected = devices.find((d) => d.id === selectedId) ?? null;
  const playheadPt = historyPoints && playheadIdx !== null ? historyPoints[playheadIdx] : null;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="order-2 min-h-0 flex-1 border-t border-border lg:order-1 lg:w-80 lg:flex-none lg:border-r lg:border-t-0">
        <DevicePanel devices={visibleDevices} selectedId={selectedId} loading={loading} error={error} onSelect={onSelect} />
      </div>

      <div className="relative order-1 flex h-[45vh] min-h-0 flex-1 flex-col lg:order-2 lg:h-auto">
        <div className="min-h-0 flex-1">
          <LiveMap
            devices={visibleDevices}
            selectedId={selectedId}
            track={track}
            historyPoints={historyPoints}
            playheadIdx={playheadIdx}
            onSelect={onSelect}
          />
        </div>

        {/* Trail playback scrubber */}
        {historyPoints && historyPoints.length > 1 && (
          <div className="border-t border-border bg-card/95 px-4 py-2 backdrop-blur">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <input
                  type="range"
                  min={0}
                  max={historyPoints.length - 1}
                  value={playheadIdx ?? historyPoints.length - 1}
                  onChange={(e) => {
                    setPlaying(false);
                    setPlayheadIdx(Number(e.target.value));
                  }}
                  className="h-1.5 w-full cursor-pointer accent-primary"
                />
              </div>
              <div className="w-40 shrink-0 text-right">
                {playheadPt ? (
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {new Date(playheadPt.fixTime).toLocaleTimeString()} · {Math.round(playheadPt.speedKph)} km/h
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {!selected && <OnboardingChecklist hasDevices={devices.length > 0} />}

        {selected && (
          <div className="absolute left-4 top-4 max-h-[calc(100%-2rem)] w-64 animate-fade-in overflow-y-auto rounded-lg border border-border bg-card/95 p-4 shadow-xl backdrop-blur scrollbar-thin">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold leading-tight">{selected.name}</p>
                {selected.registrationNumber && (
                  <p className="text-xs text-muted-foreground">{selected.registrationNumber}</p>
                )}
              </div>
              <button
                onClick={clearSelection}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-muted/60 p-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Gauge className="h-3 w-3" /> Speed
                </div>
                <p className="mt-0.5 font-semibold">
                  {playheadPt
                    ? formatSpeed(playheadPt.speedKph)
                    : selected.lastPosition
                      ? formatSpeed(selected.lastPosition.speedKph)
                      : '—'}
                </p>
              </div>
              <div className="rounded-md bg-muted/60 p-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Navigation className="h-3 w-3" /> Heading
                </div>
                <p className="mt-0.5 font-semibold">
                  {playheadPt
                    ? `${Math.round(playheadPt.course)}°`
                    : selected.lastPosition
                      ? `${Math.round(selected.lastPosition.course)}°`
                      : '—'}
                </p>
              </div>
            </div>
            {(playheadPt ?? selected.lastPosition) && (
              <p className="mt-3 font-mono text-xs text-muted-foreground">
                {(playheadPt ?? selected.lastPosition)!.latitude.toFixed(5)},{' '}
                {(playheadPt ?? selected.lastPosition)!.longitude.toFixed(5)}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {playheadPt ? new Date(playheadPt.fixTime).toLocaleString() : `Updated ${timeAgo(selected.lastSeen)}`}
            </p>
            <Telemetry attributes={selected.attributes} />
          </div>
        )}
      </div>
    </div>
  );
}
