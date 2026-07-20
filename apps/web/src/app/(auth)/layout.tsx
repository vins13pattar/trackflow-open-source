import { Bell, Map, Route, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Brand } from '@/components/Brand';

const features = [
  { icon: Map, title: 'Real-time tracking', desc: 'Live positions from 200+ GPS protocols.' },
  { icon: Route, title: 'Trips & playback', desc: 'Replay routes and analyze driver behavior.' },
  { icon: ShieldCheck, title: 'Geofencing', desc: 'Entry/exit/dwell alerts that actually fire.' },
  { icon: Bell, title: 'Multi-channel alerts', desc: 'Email, SMS, push and WhatsApp.' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-800 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_40%)]" />
        <Brand className="relative" />
        <div className="relative space-y-8">
          <div>
            <h1 className="text-3xl font-bold leading-tight">
              Track your fleet.
              <br />
              In real time. At low cost.
            </h1>
            <p className="mt-3 max-w-md text-indigo-100">
              The hybrid-serverless GPS platform built for India-first fleets — and ready to scale globally.
            </p>
          </div>
          <ul className="grid max-w-md grid-cols-2 gap-4">
            {features.map((f) => (
              <li key={f.title} className="rounded-lg bg-white/10 p-4 backdrop-blur-sm">
                <f.icon className="mb-2 h-5 w-5" />
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-indigo-100">{f.desc}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-indigo-200">© {new Date().getFullYear()} TrackFlow</p>
      </div>

      <div className="flex flex-col items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm animate-fade-in">
          <Brand className="mb-8 lg:hidden" />
          {children}
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          {' · '}
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
        </p>
      </div>
    </div>
  );
}
