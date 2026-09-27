// The ending: at the first detonation the simulation stops being a game.

export interface EndingFacts {
  /** Flight tag, e.g. 'MM-III #1' */
  tag: string;
  /** Where the first warhead fell */
  target: string;
  /** Side that was struck */
  defender: string;
  /** Seconds of warning the defender had before the first impact (null: none) */
  warning: number | null;
  /** Sensor that gave the first warning */
  warnedBy: string | null;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function lines(f: EndingFacts): string[] {
  const out = [`DETONATION CONFIRMED — ${f.target.toUpperCase()}`];
  if (f.warning !== null && f.warnedBy) {
    const min = Math.floor(f.warning / 60);
    out.push(
      `${f.defender} EARLY WARNING (${f.warnedBy.toUpperCase()}) SAW ${f.tag} ${min} MINUTES BEFORE IMPACT.`,
      'THAT WAS ENOUGH TIME TO ANSWER.',
      'THEIR MISSILES ARE ALREADY IN THE AIR.',
    );
  } else {
    out.push('NO WARNING WAS GIVEN. THE ANSWER WILL COME ANYWAY —', 'FROM THE SEA, FROM THE AIR, FROM WHATEVER SURVIVES.');
  }
  out.push('', 'EVERY SIMULATION OF THIS WAR ENDS THE SAME WAY.', 'THERE IS NO WINNER.');
  return out;
}

/**
 * White flash, then the ending text typed out line by line. `onContinue`
 * returns to the paused simulation; `onRestart` reloads the game.
 */
export function playEnding(facts: EndingFacts, onContinue: () => void, onRestart: () => void) {
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
  }, 1400);

  (document.getElementById('endingContinue') as HTMLButtonElement).onclick = () => {
    ending.hidden = true;
    onContinue();
  };
  (document.getElementById('endingRestart') as HTMLButtonElement).onclick = onRestart;
}
