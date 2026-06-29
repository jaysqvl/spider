import {
  BarChart3,
  CircleHelp,
  Download,
  Info,
  Lightbulb,
  Play,
  RotateCcw,
  Settings,
  Undo2,
  Redo2
} from "lucide-react";
import { DIFFICULTIES, type Difficulty, type GameState } from "../game/types";
import { IconButton } from "./IconButton";

interface ToolbarProps {
  game: GameState;
  selectedDifficulty: Difficulty;
  canInstallUpdate: boolean;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onNewGame: () => void;
  onRestart: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onHint: () => void;
  onDeal: () => void;
  onSettings: () => void;
  onStats: () => void;
  onAbout: () => void;
  onInstallUpdate: () => void;
}

export function Toolbar({
  game,
  selectedDifficulty,
  canInstallUpdate,
  onDifficultyChange,
  onNewGame,
  onRestart,
  onUndo,
  onRedo,
  onHint,
  onDeal,
  onSettings,
  onStats,
  onAbout,
  onInstallUpdate
}: ToolbarProps) {
  return (
    <header className="app-toolbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          ♠
        </span>
        <div>
          <h1>Spider</h1>
          <p>{DIFFICULTIES[game.difficulty].label}</p>
        </div>
      </div>

      <div className="toolbar-actions" aria-label="Game actions">
        <label className="difficulty-picker">
          <span>Difficulty</span>
          <select value={selectedDifficulty} onChange={(event) => onDifficultyChange(event.target.value as Difficulty)}>
            {Object.entries(DIFFICULTIES).map(([value, config]) => (
              <option key={value} value={value}>
                {config.label}
              </option>
            ))}
          </select>
        </label>
        <IconButton icon={<Play size={18} />} label="New Game" onClick={onNewGame} />
        <IconButton icon={<RotateCcw size={18} />} label="Restart" onClick={onRestart} />
        <IconButton icon={<Undo2 size={18} />} label="Undo" onClick={onUndo} disabled={game.undoStack.length === 0} />
        <IconButton icon={<Redo2 size={18} />} label="Redo" onClick={onRedo} disabled={game.redoStack.length === 0} />
        <IconButton icon={<Lightbulb size={18} />} label="Hint" onClick={onHint} />
        <IconButton icon={<CircleHelp size={18} />} label="Deal" onClick={onDeal} disabled={game.stock.length === 0} />
      </div>

      <div className="utility-actions" aria-label="Application actions">
        {canInstallUpdate ? (
          <IconButton icon={<Download size={18} />} label="Install Update" compact onClick={onInstallUpdate} />
        ) : null}
        <IconButton icon={<Settings size={18} />} label="Settings" compact onClick={onSettings} />
        <IconButton icon={<BarChart3 size={18} />} label="Stats" compact onClick={onStats} />
        <IconButton icon={<Info size={18} />} label="About" compact onClick={onAbout} />
      </div>
    </header>
  );
}
