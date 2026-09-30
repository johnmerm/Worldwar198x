// Messages between the two players' windows. Player 1 is the main page,
// player 2 a popup it opens; both are the same page and talk over a
// BroadcastChannel named after the game.

import type { IntelPacket } from '../game/intel';
import type { Side } from '../game/sites';
import type { ClockState } from './clock';

export type Role = 'p1' | 'p2';

export type Message =
  /** A window came up (p2: asks for the clock and sides; p1: a new game started) */
  | { type: 'hello'; from: Role }
  /** Player 1's answer to a hello */
  | { type: 'welcome'; side: Side; clock: ClockState }
  | { type: 'side'; side: Side }
  | { type: 'clock'; clock: ClockState }
  /** What the receiver's sensors saw of the sender's missiles */
  | { type: 'intel'; packet: IntelPacket }
  | { type: 'bye'; from: Role }
  | { type: 'restart' };

export interface Link {
  role: Role;
  game: string;
  send(m: Message): void;
  onMessage(handler: (m: Message) => void): void;
}

/** Role and game id from the URL; player 1 gets a fresh game id written into its URL. */
export function openLink(): Link {
  const url = new URL(window.location.href);
  const role: Role = url.searchParams.get('role') === 'p2' ? 'p2' : 'p1';
  let game = url.searchParams.get('game');
  if (!game) {
    game = Math.random().toString(36).slice(2, 10);
    url.searchParams.set('game', game);
    history.replaceState(null, '', url);
  }
  const channel = new BroadcastChannel(`ww198x-${game}`);
  return {
    role,
    game,
    send: (m) => channel.postMessage(m),
    onMessage: (handler) => channel.addEventListener('message', (e: MessageEvent<Message>) => handler(e.data)),
  };
}

/** URL of player 2's window for this game. */
export function playerTwoUrl(game: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('game', game);
  url.searchParams.set('role', 'p2');
  return url.toString();
}
