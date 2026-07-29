// Deters casual copying/saving of catalogue text and imagery. Pairs with the
// CSS rules in index.css (user-select:none, user-drag:none). This is a
// deterrent only — DevTools and screenshots still work — but it blocks the
// common right-click-save, drag-out, and select-copy paths.
//
// Form fields stay fully usable: typing, selecting, copy/paste inside
// inputs/textareas/contenteditable is intentionally allowed.

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

export function installContentProtection(): void {
  if (typeof document === 'undefined') return;

  // Right-click / long-press context menu — except inside form fields.
  document.addEventListener('contextmenu', (e) => {
    if (!isEditable(e.target)) e.preventDefault();
  });

  // Copy / cut of page content — allowed only when a field is being edited.
  const guard = (e: Event) => {
    if (!isEditable(e.target)) e.preventDefault();
  };
  document.addEventListener('copy', guard);
  document.addEventListener('cut', guard);

  // Dragging images (or any element) out of the page.
  document.addEventListener('dragstart', (e) => {
    if (!isEditable(e.target)) e.preventDefault();
  });
}
