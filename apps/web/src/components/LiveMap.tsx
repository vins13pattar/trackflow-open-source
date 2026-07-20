'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { MAP_STYLE } from '@/lib/api';
import type { DeviceSummary, HistoryPoint } from '@/lib/types';
import { deviceConnectivity } from '@/lib/utils';

interface Props {
  devices: DeviceSummary[];
  selectedId: string | null;
  track: [number, number][] | null;
  historyPoints?: HistoryPoint[] | null;
  playheadIdx?: number | null;
  onSelect: (id: string) => void;
}

const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2l7 19-7-4-7 4z"/></svg>';

function styleMarker(el: HTMLElement, selected: boolean, status: string) {
  el.dataset.selected = String(selected);
  el.dataset.status = status;
}

const CLUSTER_MAX_ZOOM = 12;

export function LiveMap({ devices, selectedId, track, historyPoints, playheadIdx, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const playheadMarker = useRef<maplibregl.Marker | null>(null);
  const loaded = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [77.5946, 12.9716],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      loaded.current = true;

      // Cluster source — fed by updateClusters() when devices change.
      map.addSource('clusters', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 50,
      });
      map.addLayer({
        id: 'cluster-circle',
        type: 'circle',
        source: 'clusters',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 20, 10, 28, 50, 36],
          'circle-color': '#6366f1',
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'clusters',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 13,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#fff' },
      });
    });

    // Zoom: toggle between cluster view and individual markers.
    const syncZoomVisibility = () => {
      const clustered = map.getZoom() < CLUSTER_MAX_ZOOM;
      if (map.getLayer('cluster-circle')) {
        map.setLayoutProperty('cluster-circle', 'visibility', clustered ? 'visible' : 'none');
        map.setLayoutProperty('cluster-count', 'visibility', clustered ? 'visible' : 'none');
      }
      for (const m of markers.current.values()) {
        (m.getElement() as HTMLElement).style.display = clustered ? 'none' : '';
      }
    };
    map.on('zoom', syncZoomVisibility);

    // Click a cluster → fit bounds of its leaves.
    map.on('click', 'cluster-circle', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['cluster-circle'] });
      const f = features[0];
      if (!f || f.geometry.type !== 'Point') return;
      const src = map.getSource('clusters') as maplibregl.GeoJSONSource;
      void src.getClusterExpansionZoom(f.properties?.cluster_id as number).then((zoom) => {
        if (zoom === null) return;
        map.easeTo({ center: f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : [0, 0], zoom: zoom + 1 });
      });
    });
    map.on('mouseenter', 'cluster-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cluster-circle', () => { map.getCanvas().style.cursor = ''; });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loaded.current = false;
      markers.current.clear();
    };
  }, []);

  // Upsert markers on every device update (drives live movement).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    const clustered = map.getZoom() < CLUSTER_MAX_ZOOM;
    for (const d of devices) {
      if (!d.lastPosition) continue;
      seen.add(d.id);
      const { longitude, latitude, course } = d.lastPosition;
      let marker = markers.current.get(d.id);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'tf-marker';
        el.innerHTML = ARROW;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(d.id);
        });
        marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
          .setLngLat([longitude, latitude])
          .addTo(map);
        markers.current.set(d.id, marker);
      } else {
        marker.setLngLat([longitude, latitude]);
      }
      marker.setRotation(course);
      styleMarker(marker.getElement(), d.id === selectedId, deviceConnectivity(d));
      (marker.getElement() as HTMLElement).style.display = clustered ? 'none' : '';
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }

    // Update cluster source data.
    const clusterData = {
      type: 'FeatureCollection' as const,
      features: devices
        .filter((d) => d.lastPosition)
        .map((d) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [d.lastPosition!.longitude, d.lastPosition!.latitude] },
          properties: { id: d.id },
        })),
    };
    const apply = () => (map.getSource('clusters') as maplibregl.GeoJSONSource | undefined)?.setData(clusterData as never);
    if (loaded.current) apply();
    else map.once('load', apply);
  }, [devices, selectedId]);

  // Fly to the selected device.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const d = devices.find((x) => x.id === selectedId);
    if (d?.lastPosition) {
      map.flyTo({
        center: [d.lastPosition.longitude, d.lastPosition.latitude],
        zoom: Math.max(map.getZoom(), 14),
        duration: 900,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Draw the selected device's track.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: track ?? [] },
      properties: {},
    };
    const draw = () => {
      const src = map.getSource('track') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data as never);
      } else {
        map.addSource('track', { type: 'geojson', data: data as never });
        map.addLayer({
          id: 'track-line',
          type: 'line',
          source: 'track',
          paint: { 'line-color': '#818cf8', 'line-width': 4, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
    };
    if (loaded.current) draw();
    else map.once('load', draw);
  }, [track]);

  // Playhead marker — follows the scrubber position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !historyPoints || playheadIdx === null || playheadIdx === undefined) {
      playheadMarker.current?.remove();
      playheadMarker.current = null;
      return;
    }
    const pt = historyPoints[playheadIdx];
    if (!pt) return;
    if (!playheadMarker.current) {
      const el = document.createElement('div');
      el.className = 'tf-playhead';
      playheadMarker.current = new maplibregl.Marker({ element: el })
        .setLngLat([pt.longitude, pt.latitude])
        .addTo(map);
    } else {
      playheadMarker.current.setLngLat([pt.longitude, pt.latitude]);
    }
  }, [historyPoints, playheadIdx]);

  return <div ref={containerRef} className="h-full w-full bg-muted" />;
}
