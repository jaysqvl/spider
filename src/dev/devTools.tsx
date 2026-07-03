import { type ComponentType, useState } from "react";
import { TestTube } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { Modal } from "../components/Modal";
import type { GameState } from "../game/types";
import type { DevScenarioPanelProps } from "./DevScenarioPanel";

export type DevLogLevel = "info" | "warn" | "error";
export type DevLogDetails = Record<string, unknown>;

export interface DevLogEntry {
  id: number;
  at: string;
  level: DevLogLevel;
  event: string;
  details?: DevLogDetails;
}

export interface DevDiagnosticsSnapshot {
  app: DevLogDetails;
  viewport: DevLogDetails;
  layout: DevLogDetails;
  game: DevLogDetails;
  settings: DevLogDetails;
}

interface DevToolsHostProps {
  onLoadGame: (game: GameState, message: string) => void;
  getDiagnostics: () => DevDiagnosticsSnapshot;
}

type DevScenarioPanelComponent = ComponentType<DevScenarioPanelProps>;
const MAX_DEV_LOG_ENTRIES = 200;
const devLogEntries: DevLogEntry[] = [];
let nextDevLogId = 0;

export function DevToolsHost({ onLoadGame, getDiagnostics }: DevToolsHostProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [DevScenarioPanel, setDevScenarioPanel] = useState<DevScenarioPanelComponent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDevTools(): Promise<void> {
    setIsOpen(true);
    setError(null);

    if (DevScenarioPanel !== null || isLoading) {
      return;
    }

    setIsLoading(true);

    try {
      const panel = await loadDevScenarioPanel();

      setDevScenarioPanel(() => panel);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Testing states could not load.";

      setError(message);
      console.warn("Unable to load dev testing states.", loadError);
    } finally {
      setIsLoading(false);
    }
  }

  function handleLoadGame(nextGame: GameState, label: string): void {
    recordDevLog("dev.state.load", {
      label,
      difficulty: nextGame.difficulty,
      seed: nextGame.seed,
      tableauHeights: nextGame.tableau.map((column) => column.length)
    });
    setIsOpen(false);
    onLoadGame(nextGame, `Dev state loaded: ${label}.`);
  }

  return (
    <>
      <IconButton icon={<TestTube size={19} />} label="Testing" compact onClick={() => void openDevTools()} />

      {isOpen ? (
        <Modal title="Testing" onClose={() => setIsOpen(false)}>
          {DevScenarioPanel ? (
            <DevScenarioPanel onLoadGame={handleLoadGame} onClose={() => setIsOpen(false)} getDiagnostics={getDiagnostics} />
          ) : (
            <div className="reset-panel">
              <TestTube size={30} aria-hidden="true" />
              <p>{error ?? "Loading testing states."}</p>
              {error ? (
                <div className="modal-actions">
                  <button type="button" onClick={() => void openDevTools()}>
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

async function loadDevScenarioPanel(): Promise<DevScenarioPanelComponent> {
  const module = await import("./DevScenarioPanel");

  return module.DevScenarioPanel;
}

export function recordDevLog(event: string, details?: DevLogDetails, level: DevLogLevel = "info"): void {
  nextDevLogId += 1;
  devLogEntries.push({
    id: nextDevLogId,
    at: new Date().toISOString(),
    level,
    event,
    details
  });

  if (devLogEntries.length > MAX_DEV_LOG_ENTRIES) {
    devLogEntries.splice(0, devLogEntries.length - MAX_DEV_LOG_ENTRIES);
  }
}

export function getDevLogEntries(): DevLogEntry[] {
  return devLogEntries.map((entry) => ({
    ...entry,
    details: entry.details === undefined ? undefined : { ...entry.details }
  }));
}

export function clearDevLogEntries(): void {
  devLogEntries.length = 0;
}
