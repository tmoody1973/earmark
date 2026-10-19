// The Link box starts with the tip's known link (decision 049): the owner's own (ownLink) or the one a lookup found.
// Only a different link, or clearing the owner's own, is a change; a link a lookup found can't be cleared from here
// (linkTip clears only the owner's), so emptying the box over it changes nothing. Pure.
export function linkChanged(was: { link: string | null; ownLink: boolean }, typed: string): boolean {
  const now = typed.trim() || null;
  return now === null ? was.ownLink && was.link !== null : now !== was.link?.trim();
}
