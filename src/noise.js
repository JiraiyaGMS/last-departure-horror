// A coin toss that lands the same way for a whole slice of time (a sixtieth
// of a second, by default), the same for every caller that asks about the
// same moment. A flicker built on it looks the same on a 60 Hz screen as on a
// 144 Hz one: the same number of dropouts a second, each as long, where a
// fresh Math.random() every frame stutters more often the faster the screen.
export function flick(t, seed = 0, hz = 60) {
  const h = Math.sin(Math.floor(t * hz) * 12.9898 + seed * 78.233) * 43758.5453;
  return h - Math.floor(h);
}
