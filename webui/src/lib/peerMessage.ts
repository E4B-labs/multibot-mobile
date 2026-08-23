/**
 * Koperta dorzucana przez serwer do wiadomości bot→bot:
 *   [Message from @Cytrynka, another bot in this MultiBot workspace. Reply to them.]
 * To kontekst dla modelu odbiorcy, nie treść dla człowieka — interfejs rozpoznaje
 * ją przy przyjęciu wiadomości (hydrate/messageAdded/messagePatched w
 * `state/store.tsx`): nazwę nadawcy trzyma jako `Message.peerFrom`, a samą
 * kopertę zdejmuje z tekstu.
 */

/** Nadawca + treść bez koperty, albo `null`, gdy wiadomość koperty nie ma. */
export function parsePeerEnvelope(text: string): { from: string; rest: string } | null {
  const match = text.match(/^\[Message from @([^\],]+)[^\]]*\]\s*/);
  return match ? { from: match[1]!.trim(), rest: text.slice(match[0].length) } : null;
}

export function stripPeerEnvelope(text: string): string {
  return parsePeerEnvelope(text)?.rest ?? text;
}
