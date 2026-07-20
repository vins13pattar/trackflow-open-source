'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { MAP_STYLE } from '@/lib/api';
import type { GeofenceSummary } from '@/lib/types';
import { circleToPolygon } from '@/lib/utils';

interface Props {
  geofences: GeofenceSummary[];
  creating: boolean;
  drawMode: 'circle' | 'polygon';
  draftCenter: { lat: number; lng: number } | null;
  draftRadiusM: number;
  draftPolygon: { lat: number; lng: number }[];
  onPick: (lat: number, lng: number) => void;
  onPolygonClose: () => void;
}

function featureCollection(geofences: GeofenceSummary[]) {
  return {
    type: 'FeatureCollection' as const,
    features: geofences.flatMap((g) => {
      if (g.type === 'circle' && g.center && g.radiusM) {
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [circleToPolygon(g.center, g.radiusM)] },
            properties: { color: g.color },
          },
        ];
      }
      if (g.type === 'polygon' && g.points && g.points.length >= 3) {
        const coords = g.points.map((p) => [p.lng, p.lat] as [number, number]);
        // Close the ring
        const first = g.points[0]!;
        coords.push([first.lng, first.lat]);
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [coords] },
            properties: { color: g.color },
          },
        ];
      }
      return [];
    }),
  };
}

export function GeofenceMap({ geofences, creating, drawMode, draftCenter, draftRadiusM, draftPolygon, onPick, onPolygonClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const pickRef = useRef(onPick);
  const polygonCloseRef = useRef(onPolygonClose);
  const creatingRef = useRef(creating);
  const drawModeRef = useRef(drawMode);
  pickRef.current = onPick;
  polygonCloseRef.current = onPolygonClose;
  creatingRef.current = creating;
  drawModeRef.current = drawMode;

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
      map.addSource('geofences', { type: 'geojson', data: featureCollection([]) as never });
      map.addLayer({ id: 'gf-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'gf-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
      map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#22c55e', 'line-width': 2, 'line-dasharray': [2, 1] } });
      map.addSource('draft-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({
        id: 'draft-points',
        type: 'circle',
        source: 'draft-points',
        paint: { 'circle-radius': 5, 'circle-color': '#22c55e', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
      });
    });
    map.on('click', (e) => {
      if (!creatingRef.current) return;
      if (drawModeRef.current === 'polygon') {
        pickRef.current(e.lngLat.lat, e.lngLat.lng);
      } else {
        pickRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    });
    map.on('dblclick', (e) => {
      if (!creatingRef.current) return;
      if (drawModeRef.current === 'polygon') {
        e.preventDefault();
        polygonCloseRef.current();
      }
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
  }, []);

  // Existing geofences.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => (map.getSource('geofences') as maplibregl.GeoJSONSource)?.setData(featureCollection(geofences) as never);
    if (loaded.current) apply();
    else map.once('load', apply);
  }, [geofences]);

  // Draft preview: circle or polygon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let draftData: GeoJSON.FeatureCollection;
    let pointsData: GeoJSON.FeatureCollection;

    if (creating && drawMode === 'circle' && draftCenter) {
      draftData = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [circleToPolygon(draftCenter, draftRadiusM)] },
            properties: {},
          },
        ],
      };
      pointsData = { type: 'FeatureCollection', features: [] };
    } else if (creating && drawMode === 'polygon' && draftPolygon.length >= 2) {
      const coords = draftPolygon.map((p) => [p.lng, p.lat] as [number, number]);
      let geometry: GeoJSON.Geometry;
      if (draftPolygon.length >= 3) {
        // Render as closed polygon
        const ring: [number, number][] = [...coords, coords[0]!];
        geometry = { type: 'Polygon', coordinates: [ring] };
      } else {
        // Just a line
        geometry = { type: 'LineString', coordinates: coords };
      }
      draftData = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry, properties: {} }],
      };
      pointsData = {
        type: 'FeatureCollection',
        features: draftPolygon.map((p) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
          properties: {},
        })),
      };
    } else {
      draftData = { type: 'FeatureCollection', features: [] };
      pointsData = { type: 'FeatureCollection', features: [] };
    }

    const apply = () => {
      (map.getSource('draft') as maplibregl.GeoJSONSource)?.setData(draftData as never);
      (map.getSource('draft-points') as maplibregl.GeoJSONSource)?.setData(pointsData as never);
    };
    if (loaded.current) apply();
    else map.once('load', apply);
  }, [creating, drawMode, draftCenter, draftRadiusM, draftPolygon]);

  // Cursor hint while drawing.
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = creating ? 'crosshair' : '';
  }, [creating]);

  return <div ref={containerRef} className="h-full w-full bg-muted" />;
}
