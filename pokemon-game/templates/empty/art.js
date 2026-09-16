// Art this game adds of its own, on top of the engine's tiles and characters.
// Pixel-string art (palette + rows) or images imported from Aseprite both work;
// see docs/IMPORTING.md. Empty to start with.
(function (root) {
  const KIT = root.KIT;
  if (!KIT || !KIT.registry) return;
  // KIT.registry('tiles').add({ id: 'my-floor', name: 'My floor', group: 'mine', palette: { a: '#4a3f36' }, rows: [ ... ] });
})(typeof window !== 'undefined' ? window : globalThis);
