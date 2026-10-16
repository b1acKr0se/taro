/**
 * How far a full-screen view's top keeps clear of the phone's status bar (TR-165), apart from
 * React Native so a test can reach it. Every full-screen modal is drawn under Android's status bar
 * (`FullScreenModal`), so Android pads by the bar's height; iOS pads in `SafeAreaView` instead, and
 * a browser pads for its own notch.
 */
export function topInset(platform: string, statusBarHeight: number | null | undefined): number {
  return platform === "android" ? (statusBarHeight ?? 0) : 0;
}
