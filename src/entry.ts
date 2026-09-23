// Research controls are a local development tool, never part of the Pages build.
// This is build-time exclusion, not a password implemented in the browser.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('mode') === 'research') {
  await import('./main.ts');
  const preview = document.getElementById('survey-mode');
  if (preview) preview.onclick = () => { location.href = new URL(import.meta.env.BASE_URL, location.href).href; };
} else {
  const { allowPublicStart } = await import('./runtime/launch-gate.ts');
  if (await allowPublicStart()) {
    await import('./participant.ts');
    // participant.ts renders synchronously; the obsolete link has no public target.
    if (import.meta.env.PROD) document.getElementById('g-research')?.remove();
  }
}
export {};
