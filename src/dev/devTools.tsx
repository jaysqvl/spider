import { type ComponentType, useState } from "react";
import { TestTube } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { Modal } from "../components/Modal";
import type { GameState } from "../game/types";
import type { DevScenarioPanelProps } from "./DevScenarioPanel";

interface DevToolsHostProps {
  onLoadGame: (game: GameState, message: string) => void;
}

type DevScenarioPanelComponent = ComponentType<DevScenarioPanelProps>;

export function DevToolsHost({ onLoadGame }: DevToolsHostProps) {
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
    setIsOpen(false);
    onLoadGame(nextGame, `Dev state loaded: ${label}.`);
  }

  return (
    <>
      <IconButton icon={<TestTube size={19} />} label="Testing" compact onClick={() => void openDevTools()} />

      {isOpen ? (
        <Modal title="Testing" onClose={() => setIsOpen(false)}>
          {DevScenarioPanel ? (
            <DevScenarioPanel onLoadGame={handleLoadGame} onClose={() => setIsOpen(false)} />
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
