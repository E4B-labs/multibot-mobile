/**
 * Koperta dorzucana przez serwer do wiadomości bot→bot:
 *   [Message from @Cytrynka, another bot in this MultiBot workspace. Reply to them.]
 * To kontekst dla modelu odbiorcy, nie treść dla człowieka — interfejs zdejmuje
 * ją z początku tekstu przy przyjęciu wiadomości (hydrate/messageAdded/
 * messagePatched w `state/store.tsx`).
 */
export function stripPeerEnvelope(text: string): string {
  return text.replace(/^\[Message from @[^\]]+\]\s*/, "");
}
