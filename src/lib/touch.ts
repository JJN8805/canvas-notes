/** True on a touch screen (the main pointer is a finger). Decides wording ("tap", not "click"), and which keys/hints are shown. */
export const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
