// The ending: when a nation is gone, the simulation stops being a game.

export interface EndingFacts {
  /** The story, one line each ('' for a pause) */
  lines: string[];
  /** The last, large line: YOU WIN / YOU LOSE / NOBODY WINS */
  verdict: string;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const lines = (f: EndingFacts) => [...f.lines, '', f.verdict];

/**
 * White flash, then the ending text typed out line by line. `onContinue`
 * returns to the paused simulation; `onRestart` reloads the game.
 */
export function playEnding(facts: EndingFacts, onContinue: () => void, onRestart: () => void, textDelayMs = 1400) {
  const flash = document.getElementById('flash')!;
  const ending = document.getElementById('ending')!;
  const text = document.getElementById('endingText')!;
  const buttons = document.getElementById('endingButtons')!;

  flash.hidden = false;
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.add('go');
  window.setTimeout(() => (flash.hidden = true), 2600);

  text.innerHTML = '';
  buttons.hidden = true;
  const all = lines(facts);
  window.setTimeout(() => {
    ending.hidden = false;
    const instant = reducedMotion();
    let li = 0;
    const nextLine = () => {
      if (li >= all.length) {
        buttons.hidden = false;
        return;
      }
      const p = document.createElement('p');
      if (li === all.length - 1) p.className = 'final';
      text.append(p);
      const line = all[li++];
      if (instant) {
        p.textContent = line;
        nextLine();
        return;
      }
      let ci = 0;
      const type = () => {
        p.textContent = line.slice(0, ++ci);
        if (ci < line.length) window.setTimeout(type, 28);
        else window.setTimeout(nextLine, line ? 650 : 250);
      };
      type();
    };
    nextLine();
  }, textDelayMs);

  (document.getElementById('endingContinue') as HTMLButtonElement).onclick = () => {
    ending.hidden = true;
    onContinue();
  };
  (document.getElementById('endingRestart') as HTMLButtonElement).onclick = onRestart;
}
