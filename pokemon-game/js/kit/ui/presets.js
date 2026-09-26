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

  // Three more, each the few things that make a well-known kind of game feel
  // like itself: the box, the cursor, the menu, the voice, and how the words
  // arrive — how fast they type, how a page turns, where the answers go.
  // Colours, glyphs, font stacks and the kit's own synth sounds only — no
  // pictures and no fonts, so nothing here belongs to anybody. The
  // descriptions say what a look does TODAY. Handheld's and Soul's pause-menu
  // order is held for when the game can reorder the menu, and the words will
  // grow with it.
  KIT.registry('looks').addAll([
    {
      id: 'handheld', label: 'Handheld', rev: 1, base: 'kit',
      describe: 'A white two-line box with a soft shadow under the letters, slow silent typing, a page that scrolls up a line at a time, Yes and No in a little window above the box, and a start menu down the right in capitals.',
      ui: {
        tokens: { paper: '#f8f8f8', ink: '#404040', shadow: '#d0d0c8', frame: '#5a6a86', frameWidth: 4, radius: 4,
          rim: '#c8d0e0', drop: null, accent: '#404040', markerInk: '#e03030', select: null, lineHeight: 1.6,
          titleBg: '#284878' },
        dialogue: { lines: 2, name: 'none', face: 'none', marker: '▼', markerMotion: 'bob',
          pageTurn: 'scroll', speeds: { slow: 8, normal: 16, fast: 60 } },
        choice: { place: 'above-box' },
        cursor: { glyph: '▶', highlight: false },
        menu: { at: 'right', title: false, hint: false, caps: true, order: ['*', 'keep-playing'] },
        toast: { at: 'bottom', shape: 'box' },
        sounds: { confirm: 'select', page: 'select' },
        voice: 'none',
      },
    },
    {
      id: 'soul', label: 'Soul', rev: 1, base: 'kit',
      describe: 'A black box with a square white border, “* ” at the start of each line, a blip on every letter, a box that moves to the top when the hero is below it, and the answers in a row inside the box with a heart for a cursor.',
      ui: {
        tokens: { paper: '#000000', ink: '#ffffff', frame: '#ffffff', frameWidth: 3, radius: 0, rim: null, drop: null,
          accent: '#ffffff', select: null, selectInk: '#ffff00', faceBg: '#000000', fontText: 'mono', fontUi: 'mono',
          titleBg: '#000000', toastBg: '#000000', toastFrame: '#ffffff', buttonInk: '#000000', inputBg: '#000000' },
        dialogue: { width: 94, name: 'none', face: 'left', faceFrame: false, faceScale: 2, prefix: '* ', marker: '',
          at: 'avoid-hero', speeds: { slow: 20, normal: 30, fast: 60 } },
        choice: { place: 'in-box', layout: 'row' },
        cursor: { glyph: '♥', color: '#ff0000', highlight: false },
        menu: { at: 'top-left', title: false, hint: false, caps: true, hide: ['keep-playing'] },
        toast: { at: 'top', shape: 'box' },
        pad: { shape: 'square' },
        voice: 'typer',
      },
    },
    {
      id: 'dream', label: 'Dream', rev: 1, base: 'kit',
      describe: 'A black box with a thin white border, the speaker\'s name in capitals on a tab, a framed portrait above the box, and the answers in a window of their own beside it.',
      ui: {
        tokens: { paper: '#000000', ink: '#ffffff', frame: '#ffffff', frameWidth: 2, radius: 0, rim: null, drop: null,
          accent: '#ffffff', select: '#ffffff', selectInk: '#000000', faceBg: '#000000', buttonInk: '#000000', inputBg: '#000000' },
        dialogue: { name: 'tab', nameCase: 'upper', face: 'above-right', faceFrame: true, faceScale: 3, marker: '▼', markerMotion: 'blink' },
        choice: { place: 'beside-box' },
        // The chosen answer is a white bar, so the hand pointing at it is black.
        cursor: { glyph: '☞', color: '#000000', highlight: true },
        menu: { title: false, caps: true },
        voice: 'soft',
      },
    },
  ]);

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
