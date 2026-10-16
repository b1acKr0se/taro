/**
 * A layer over the whole Taro screen, for a dialog drawn by a pane inside it (TR-161). Inside the
 * screen's own tree, not React Native's `Modal`: on the web a `Modal` is drawn outside the app's
 * tree and its text loses the app's font, and the host's `Modal` turns into a bottom sheet on a phone.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";

const ScreenLayer = createContext<((node: ReactNode | null) => void) | null>(
  null,
);

/** Wraps the screen: its children, then whatever a pane shows over them. */
export function ScreenLayerHost({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<ReactNode | null>(null);
  return (
    <ScreenLayer.Provider value={setShown}>
      <View style={{ flex: 1 }}>
        {children}
        {shown === null ? null : (
          <View
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 10,
            }}
          >
            {shown}
          </View>
        )}
      </View>
    </ScreenLayer.Provider>
  );
}

/** Shows `node` over the screen while it is not null. */
export function useScreenLayer(node: ReactNode | null): void {
  const show = useContext(ScreenLayer);
  useEffect(() => {
    show?.(node);
  }, [show, node]);
  // Taken down when the pane goes, not left over the screen.
  useEffect(() => () => show?.(null), [show]);
}
