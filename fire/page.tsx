'use client';

import dynamic from 'next/dynamic';

// WebGL працює лише в браузері, тому без SSR
const FireOrbScene = dynamic(() => import('@/components/fire-orb/FireOrbScene'), { ssr: false });

export default function Page() {
  return (
    <main style={{ height: '100vh', background: '#030202' }}>
      {/* debug — панель налаштувань; modelUrl="/models/demon.glb" — власна модель із /public */}
      <FireOrbScene debug />
    </main>
  );
}
