import { useEffect, useState } from "react";
import VoiceConsole from "./features/voice-console/VoiceConsole";
import TechnicalDocs from "./TechnicalDocs";
import styles from "./App.module.css";

type AppView = "console" | "docs";

function viewFromHash(hash: string): AppView {
  if (hash === "#docs") return "docs";
  return "console";
}

export default function App() {
  const [view, setView] = useState<AppView>(() =>
    typeof window === "undefined" ? "console" : viewFromHash(window.location.hash),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const switchView = (next: AppView) => {
    setView(next);
    if (typeof window !== "undefined") {
      const hash = next === "docs" ? "#docs" : "#console";
      window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
    }
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>Praxify Voice System</div>
        <nav className={styles.nav}>
          <button
            type="button"
            className={`${styles.navBtn} ${view === "console" ? styles.navBtnActive : ""}`}
            onClick={() => switchView("console")}
          >
            Realtime Console
          </button>
          <button
            type="button"
            className={`${styles.navBtn} ${view === "docs" ? styles.navBtnActive : ""}`}
            onClick={() => switchView("docs")}
          >
            Technical Docs
          </button>
        </nav>
      </header>
      {view === "console" ? <VoiceConsole /> : <TechnicalDocs />}
    </div>
  );
}
