// mons/strings.js — every line the module can show, as Terms entries.
//
// Nothing in this module prints a literal sentence: it asks for a key, so the
// author can reword the whole Pokémon side in Creator Mode's Terms panel
// without touching code, and a catch profile can point at a different key.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};

  M.STRINGS = [
    // the catch scene
    { id: 'mons-appeared', default: 'A wild {name} appeared!', doc: 'The catch scene opening line' },
    { id: 'mons-appeared-new', default: 'A wild {name} appeared! You have never met one before.' },
    { id: 'mons-gotcha', default: 'Gotcha! {name} wants to come with you.' },
    { id: 'mons-broke', default: 'It broke free!' },
    { id: 'mons-fled', default: '{name} slipped away into the grass.' },
    { id: 'mons-ran', default: 'You backed away quietly.' },
    { id: 'mons-no-balls', default: 'No Poké Balls left — next time, bring a few.' },
    { id: 'mons-no-item', default: 'You do not have any of those.' },
    { id: 'mons-calmed', default: '{name} nibbles the berry and settles down.' },
    { id: 'mons-golden', default: '{name} is delighted. The next ball will surely work.' },
    { id: 'mons-talk', default: 'You talk softly to {name}.' },
    { id: 'mons-curious', default: '{name} tilts its head and comes a little closer.' },
    { id: 'mons-nickname', default: 'Give {name} a nickname?' },
    { id: 'mons-perfect', default: 'Perfect!' },
    { id: 'mons-great', default: 'Great!' },
    { id: 'mons-ok', default: 'Okay.' },
    { id: 'mons-miss', default: 'Just off…' },
    { id: 'mons-wobble', default: '…' },
    { id: 'mons-new-mark', default: 'new!' },
    { id: 'mons-tap-ring', default: 'Tap when the ring is in the green.' },
    { id: 'mons-balls-left', default: 'Balls: {count}' },

    // actions (a profile's default labels)
    { id: 'mons-act-throw', default: 'Throw Ball' },
    { id: 'mons-act-berry', default: 'Berry' },
    { id: 'mons-act-golden', default: 'Golden Berry' },
    { id: 'mons-act-talk', default: 'Talk' },
    { id: 'mons-act-leave', default: 'Run' },

    // menus
    { id: 'mons-menu-party', default: 'Pokémon' },
    { id: 'mons-menu-dex', default: 'Pokédex' },
    { id: 'mons-party-title', default: 'Your Pokémon' },
    { id: 'mons-party-empty', default: 'You have not befriended anyone yet.' },
    { id: 'mons-party-hint', default: 'Arrows · Z opens · X closes' },
    { id: 'mons-dex-title', default: 'Pokédex' },
    { id: 'mons-dex-count', default: 'Seen {seen} · Befriended {caught} of {total}' },
    { id: 'mons-dex-unseen', default: 'Not met yet.' },
    { id: 'mons-met-at', default: 'Met at {where}, {when}.' },
    { id: 'mons-met-unknown', default: 'You do not remember where.' },
    { id: 'mons-in-garden', default: 'In the garden' },
    { id: 'mons-in-party', default: 'With you' },
    { id: 'mons-details', default: 'Details' },
    { id: 'mons-back', default: 'Back' },
    { id: 'mons-close', default: 'Close' },
    { id: 'mons-move-up', default: 'Move up' },
    { id: 'mons-move-down', default: 'Move down' },
    { id: 'mons-send-garden', default: 'Send to the garden' },
    { id: 'mons-take-along', default: 'Take along' },
    { id: 'mons-leave-here', default: 'Leave here' },
    { id: 'mons-follow', default: 'Walk with me' },
    { id: 'mons-following', default: 'Walking with you' },
    { id: 'mons-party-full', default: 'Six is all you can carry.' },
    { id: 'mons-sent-garden', default: '{name} is off to the garden.' },
    { id: 'mons-taken-along', default: '{name} comes along!' },

    // the garden card
    { id: 'mons-pet', default: 'Pet' },
    { id: 'mons-pet-done', default: '{name} leans into your hand.' },
    { id: 'mons-pet-again', default: '{name} has had plenty of fuss for now.' },
    { id: 'mons-give-berry', default: 'Give a berry' },
    { id: 'mons-berry-given', default: '{name} eats the berry happily. (+{n})' },
    { id: 'mons-berry-favourite', default: 'It is {name}’s favourite! (+{n})' },
    { id: 'mons-no-berries', default: 'You have no berries left.' },
    { id: 'mons-ball-idle', default: 'Save it for somebody you meet.' },
    { id: 'mons-berry-nobody', default: 'Nobody is walking with you yet.' },
    { id: 'mons-shiny', default: 'shiny' },

    // the follower
    { id: 'mons-follower-line', default: '{name} is {mood}.' },
    { id: 'mons-friendship-up', default: '{name} looks a little happier.' },
    { id: 'mons-joined', default: '{name} joined you!' },
    { id: 'mons-joined-garden', default: '{name} went to wait in the garden.' },
    { id: 'mons-welcome-back', default: 'Everyone missed you while you were away.' },

    // moods
    { id: 'mons-mood-happy', default: 'happy' },
    { id: 'mons-mood-sleepy', default: 'sleepy' },
    { id: 'mons-mood-curious', default: 'curious' },
    { id: 'mons-mood-playful', default: 'playful' },
    { id: 'mons-mood-hungry', default: 'hungry' },
    { id: 'mons-mood-shy', default: 'shy' },
    { id: 'mons-mood-proud', default: 'proud' },
    { id: 'mons-mood-calm', default: 'calm' },

    // friendship tiers
    { id: 'mons-tier-new', default: 'Newly met' },
    { id: 'mons-tier-warm', default: 'Warming up' },
    { id: 'mons-tier-close', default: 'Close' },
    { id: 'mons-tier-dear', default: 'Dear friend' },
    { id: 'mons-tier-devoted', default: 'Devoted' },
    { id: 'mons-tier-bonded', default: 'Inseparable' },

    // rarity
    { id: 'mons-rarity-common', default: 'Common' },
    { id: 'mons-rarity-uncommon', default: 'Uncommon' },
    { id: 'mons-rarity-rare', default: 'Rare' },
    { id: 'mons-rarity-special', default: 'Special' },
    { id: 'mons-rarity-legendary', default: 'Legendary' },

    // the editor panel
    { id: 'mons-panel-encounters', default: 'Encounters' },
    { id: 'mons-panel-hint', default: 'Who lives in the tall grass on this map, and how often you meet them.' },
  ];

  /** registerStrings() — idempotent; safe to call from register() more than once. */
  M.registerStrings = function () {
    const reg = KIT.registry('strings');
    for (const d of M.STRINGS) reg.add(Object.assign({ replace: true }, d));
    return M.STRINGS.length;
  };

  /** t(project, id, vars) — a registered line, with {name} style substitution. */
  M.t = function (project, id, vars) { return KIT.strings.get(project, id, vars); };
  /** tierLabel / moodLabel / rarityLabel — the words for the three derived states. */
  M.tierLabel = function (project, n) { return M.t(project, M.friendshipTier(n).label); };
  M.moodLabel = function (project, mon, opts) { return M.t(project, M.moodFor(mon, opts).label); };
  M.rarityLabel = function (project, id) { return M.t(project, 'mons-rarity-' + M.rarity(id, project)); };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
