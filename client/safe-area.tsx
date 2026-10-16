/**
 * The one way a full-screen view (a modal, a sheet, a viewer) keeps clear of the phone's status bar
 * (TR-165). React Native's `SafeAreaView` pads only on iOS, so a modal wrapped in it alone drew its
 * header under Android's clock and icons (TR-042, TR-165). `FullScreenModal` always draws under the
 * Android status bar, as the app's edge-to-edge screens do, so the inset below is always the right
 * one and never doubled; `SafeArea` frames what must stay clear of it. The only file that takes
 * `Modal`, `SafeAreaView` or `StatusBar` from react-native (`safe-area.test.ts`).
 */
import { Modal, Platform, SafeAreaView, StatusBar, View, type ModalProps, type ViewProps } from "react-native";

import { topInset } from "./safe-area-inset";

/** The Android status bar's height, zero elsewhere. */
export function statusBarInset(): number {
  return topInset(Platform.OS, StatusBar.currentHeight);
}

/** React Native's Modal, drawn under Android's status bar so `SafeArea` or `statusBarInset()` can clear it. */
export function FullScreenModal(props: ModalProps) {
  return <Modal {...props} statusBarTranslucent />;
}

/**
 * Content that starts at the top of a full-screen view: below the status bar on Android, inside the
 * safe area elsewhere (iOS, and a phone browser's notch, which React Native Web pads for).
 */
export function SafeArea({ style, ...rest }: ViewProps) {
  if (Platform.OS !== "android") return <SafeAreaView style={style} {...rest} />;
  // Last, so a padding in `style` cannot undo it; pad inside a child instead.
  return <View style={[style, { paddingTop: statusBarInset() }]} {...rest} />;
}

/** Content at the bottom of the screen: above iOS's home indicator; Android needs nothing. */
export function BottomSafeArea(props: ViewProps) {
  return Platform.OS === "android" ? <View {...props} /> : <SafeAreaView {...props} />;
}
