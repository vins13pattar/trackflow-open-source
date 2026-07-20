'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { INGEST_HOST, PROTOCOL_PORTS } from '@/lib/api';

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">{value}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Copy"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function ConnectionGuide({ imei, protocol }: { imei: string; protocol: string }) {
  const port = PROTOCOL_PORTS[protocol] ?? 5023;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Point your tracker at the TrackFlow server below, then it appears live automatically.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Copyable label="Server host" value={INGEST_HOST} />
        <Copyable label="Port" value={String(port)} />
        <Copyable label="IMEI" value={imei} />
      </div>

      {protocol === 'gt06' && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Configure by SMS to the device's SIM (Concox / GT06 family):</p>
          <Copyable label="1. Set server" value={`SERVER,1,${INGEST_HOST},${port},0#`} />
          <Copyable label="2. Set APN (example: Jio)" value={'APN,jionet#'} />
          <p className="text-xs text-muted-foreground">Exact commands vary by model — check your tracker's manual.</p>
        </div>
      )}

      {protocol === 'teltonika' && (
        <p className="text-xs text-muted-foreground">
          Configure with the Teltonika Configurator (or FOTA): set the GPRS server to{' '}
          <span className="font-mono">{INGEST_HOST}</span>, port <span className="font-mono">{port}</span>, protocol TCP,
          Codec 8.
        </p>
      )}

      {protocol === 'h02' && (
        <p className="text-xs text-muted-foreground">
          Set the device's server host to <span className="font-mono">{INGEST_HOST}</span> and port{' '}
          <span className="font-mono">{port}</span> via its SMS configuration commands (see the device manual).
        </p>
      )}

      {protocol === 'nmea' && (
        <p className="text-xs text-muted-foreground">
          Stream NMEA sentences to <span className="font-mono">{INGEST_HOST}:{port}</span>. NMEA carries no device ID, so
          send an identity line first or use a per-port mapping.
        </p>
      )}
    </div>
  );
}
