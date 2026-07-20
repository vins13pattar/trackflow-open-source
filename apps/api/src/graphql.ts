/**
 * Read-only GraphQL endpoint at POST /graphql.
 *
 * Authenticated with the same JWT/x-api-key middleware as the REST API — the
 * resolved principal lives in the request context, and every query runs inside
 * `withTenant` so RLS isolates rows to the caller's tenant just like the REST
 * routes. The schema deliberately stays read-only for now; mutations live on
 * the REST surface (where input validation + audit trails + per-action quotas
 * already wire up).
 *
 * Library: graphql-yoga (the modern fork of express-graphql). It hands us a
 * fetch-style handler which Hono mounts directly.
 */
import { and, desc, devices, eq, geofences, gte, lte, positions, type Tx, trips, withTenant } from '@trackflow/db';
import { createSchema, createYoga } from 'graphql-yoga';
import { db } from './db.js';
import type { Principal } from './middleware/auth.js';

interface GraphQlContext {
  principal: Principal;
}

const typeDefs = /* GraphQL */ `
  scalar DateTime
  scalar JSON

  type User {
    id: ID!
    role: String
  }

  type Position {
    id: ID!
    deviceId: ID!
    lat: Float!
    lon: Float!
    speedKph: Float
    course: Float
    gpsValid: Boolean
    fixTime: DateTime!
    attributes: JSON
  }

  type LastPosition {
    lat: Float
    lon: Float
    speedKph: Float
    course: Float
    fixTime: DateTime
  }

  type Device {
    id: ID!
    name: String!
    imei: String!
    protocol: String!
    status: String!
    type: String
    online: Boolean!
    lastSeen: DateTime
    lastPosition: LastPosition
    """All positions for this device within the window (newest first)."""
    positions(from: DateTime!, to: DateTime!, limit: Int = 1000): [Position!]!
    """Recent trips for this device (newest first)."""
    trips(limit: Int = 30): [Trip!]!
  }

  type Trip {
    id: ID!
    deviceId: ID!
    startedAt: DateTime!
    endedAt: DateTime!
    distanceKm: Float!
    avgSpeedKph: Float!
    maxSpeedKph: Float!
    durationS: Int!
  }

  type Geofence {
    id: ID!
    name: String!
    type: String!
    status: String!
    onEntry: Boolean!
    onExit: Boolean!
    onDwell: Boolean!
  }

  type Query {
    """The authenticated principal (user or API key)."""
    me: User!
    """All devices visible to the current tenant."""
    devices(status: String, limit: Int = 100): [Device!]!
    """One device by id (RLS-scoped)."""
    device(id: ID!): Device
    """All geofences for the current tenant."""
    geofences: [Geofence!]!
  }
`;

interface DeviceRow {
  id: string;
  name: string;
  imei: string;
  protocol: string;
  status: string;
  type: string | null;
  online: boolean;
  lastSeen: Date | null;
  lastLat: number | null;
  lastLon: number | null;
  lastSpeed: number | null;
  lastCourse: number | null;
  lastFixTime: Date | null;
}

function asIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

const deviceSelect = {
  id: devices.id,
  name: devices.name,
  imei: devices.imei,
  protocol: devices.protocol,
  status: devices.status,
  type: devices.type,
  online: devices.online,
  lastSeen: devices.lastSeen,
  lastLat: devices.lastLat,
  lastLon: devices.lastLon,
  lastSpeed: devices.lastSpeed,
  lastCourse: devices.lastCourse,
  lastFixTime: devices.lastFixTime,
} as const;

const resolvers = {
  Query: {
    me: (_: unknown, _args: unknown, ctx: GraphQlContext) => ({
      id: ctx.principal.userId ?? ctx.principal.keyId ?? null,
      role: ctx.principal.role ?? null,
    }),
    devices: async (_: unknown, args: { status?: string | null; limit?: number | null }, ctx: GraphQlContext) =>
      withTenant(db, ctx.principal.tenantId, async (tx: Tx) => {
        const where = args.status ? eq(devices.status, args.status) : undefined;
        const rows = await tx
          .select(deviceSelect)
          .from(devices)
          .where(where)
          .limit(Math.min(500, args.limit ?? 100));
        return rows;
      }),
    device: async (_: unknown, args: { id: string }, ctx: GraphQlContext) =>
      withTenant(db, ctx.principal.tenantId, async (tx: Tx) => {
        const [row] = await tx
          .select(deviceSelect)
          .from(devices)
          .where(eq(devices.id, args.id))
          .limit(1);
        return row ?? null;
      }),
    geofences: async (_: unknown, _args: unknown, ctx: GraphQlContext) =>
      withTenant(db, ctx.principal.tenantId, async (tx: Tx) =>
        tx
          .select({
            id: geofences.id,
            name: geofences.name,
            type: geofences.type,
            status: geofences.status,
            onEntry: geofences.onEntry,
            onExit: geofences.onExit,
            onDwell: geofences.onDwell,
          })
          .from(geofences)
          .orderBy(desc(geofences.createdAt))
          .limit(500),
      ),
  },
  Device: {
    lastSeen: (d: DeviceRow) => asIso(d.lastSeen),
    lastPosition: (d: DeviceRow) => {
      if (d.lastLat === null || d.lastLon === null) return null;
      return {
        lat: d.lastLat,
        lon: d.lastLon,
        speedKph: d.lastSpeed,
        course: d.lastCourse,
        fixTime: asIso(d.lastFixTime),
      };
    },
    positions: async (d: DeviceRow, args: { from: string; to: string; limit?: number | null }, ctx: GraphQlContext) =>
      withTenant(db, ctx.principal.tenantId, async (tx: Tx) => {
        const from = new Date(args.from);
        const to = new Date(args.to);
        const rows = await tx
          .select()
          .from(positions)
          .where(and(eq(positions.deviceId, d.id), gte(positions.fixTime, from), lte(positions.fixTime, to)))
          .orderBy(desc(positions.fixTime))
          .limit(Math.min(5000, args.limit ?? 1000));
        return rows.map((p) => ({
          id: String(p.id),
          deviceId: p.deviceId,
          lat: p.lat,
          lon: p.lon,
          speedKph: p.speedKph,
          course: p.course,
          gpsValid: p.gpsValid,
          fixTime: p.fixTime.toISOString(),
          attributes: p.attributes,
        }));
      }),
    trips: async (d: DeviceRow, args: { limit?: number | null }, ctx: GraphQlContext) =>
      withTenant(db, ctx.principal.tenantId, async (tx: Tx) => {
        const rows = await tx
          .select()
          .from(trips)
          .where(eq(trips.deviceId, d.id))
          .orderBy(desc(trips.startedAt))
          .limit(Math.min(200, args.limit ?? 30));
        return rows.map((r) => ({
          ...r,
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt.toISOString(),
        }));
      }),
  },
};

export function createGraphqlHandler() {
  return createYoga<GraphQlContext>({
    schema: createSchema({ typeDefs, resolvers }),
    graphqlEndpoint: '/graphql',
    landingPage: false,
    cors: false,
    graphiql: {
      defaultQuery: 'query {\n  devices(limit: 10) { id name imei status online lastSeen }\n}',
    },
  });
}
