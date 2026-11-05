/** A monitor's sound over HDMI/DisplayPort, e.g. "HP Z22i (2- HD Audio Driver for Display Audio)". */
export function isMonitorAudio(label: string): boolean {
  return /display audio|hdmi|displayport|\bdp audio\b/i.test(label);
}
