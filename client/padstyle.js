// What a press of the work button (R, □ / X) does for each gesture of the
// close-up (client/padwork.js): 'beat' – one per press, repeated while it's
// held; 'hold' – it lasts as long as the button's held; 'dir' – ↑ / ↓ set it.
// Every gesture a recipe uses has one, so every recipe can be cooked with a
// keyboard or a gamepad alone (test/padwork.test.js).
export const PAD_STYLE = {
  tap: 'beat', drag: 'beat', door: 'beat', strokes: 'beat', chop: 'beat', peel: 'beat',
  place: 'beat', flick: 'beat', crack: 'beat', wrap: 'beat', scoop: 'beat',
  circle: 'hold', pour: 'hold', fill: 'hold', paint: 'hold', dip: 'hold', knob: 'dir',
};
