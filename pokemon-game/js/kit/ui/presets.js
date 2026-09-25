// The looks the kit ships, as data: nothing here is art, and nothing here is
// code that runs. A look is overrides on top of the one it starts from, so the
// kit's own is empty — it IS the stylesheet in css/kit.css, and compiles to no
// CSS at all. Every other look is written as the few things it changes.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  KIT.registry('looks').add({
    id: 'kit', label: 'Kit', rev: 1,
    describe: 'The engine\'s own: a white box with a dark border, a pixel font for names and menus, and a blue accent.',
    ui: {},
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
