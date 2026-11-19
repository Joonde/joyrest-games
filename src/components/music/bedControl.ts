/** Ползунок «Фон» нужен и встроенной музыке платформы, и собственной музыке игры, которая идёт через ту же bed-шину. */
export function bedControlVisible(ownMusic: boolean | undefined, builtinNow: boolean, soundReady: boolean): boolean {
  return soundReady && (builtinNow || ownMusic === true);
}
