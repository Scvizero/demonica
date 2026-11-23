"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import styles from "./page.module.css";

const FireOrbScene = dynamic(
  () => import("@/components/fire-orb/FireOrbScene"),
  { ssr: false },
);

export default function Home() {
  const [awakened, setAwakened] = useState(true);
  const [ringAwake, setRingAwake] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [focusOnEyes, setFocusOnEyes] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMenuVisible(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const ignitionDelay = 1800 + Math.random() * 3200;
    const timer = window.setTimeout(() => setRingAwake(true), ignitionDelay);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className={styles.experience}>
      <div
        className={styles.scene}
        id="scene"
        role="group"
        aria-label="Інтерактивна 3D-сцена з персонажем і вогнем"
      >
        <FireOrbScene
          modelUrl={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/models/demon.glb`}
          debug={controlsOpen}
          active={awakened}
          ringActive={ringAwake}
          focusOnEyes={focusOnEyes}
        />
      </div>

      <header
        className={`${styles.header} ${menuVisible ? styles.headerVisible : ""}`}
      >
        <a
          className={styles.wordmark}
          href="#scene"
          aria-label="Demon — на початок"
        >
          <span className={styles.mark}>D</span>
          <span>
            demon<span className={styles.dot}>.</span>
          </span>
        </a>
        <nav className={styles.navigation} aria-label="Головна навігація">
          <button
            type="button"
            onClick={() => setAwakened((active) => !active)}
            aria-pressed={awakened}
          >
            ПОЛУМ’Я <span>↗</span>
          </button>
          <button
            type="button"
            onClick={() => setControlsOpen((open) => !open)}
            aria-expanded={controlsOpen}
          >
            НАЛАШТУВАННЯ <span>{controlsOpen ? "×" : "↗"}</span>
          </button>
          <button
            type="button"
            aria-pressed={focusOnEyes}
            onClick={() => setFocusOnEyes((focused) => !focused)}
          >КОНТАКТ <span>↗</span></button>
        </nav>
      </header>
      <a
        className={`${styles.contactReveal} ${focusOnEyes ? styles.contactRevealVisible : ""}`}
        href="mailto:hello@demon.studio"
        aria-hidden={!focusOnEyes}
        tabIndex={focusOnEyes ? 0 : -1}
      >
        HELLO@DEMON.STUDIO <span>↗</span>
      </a>
    </main>
  );
}
