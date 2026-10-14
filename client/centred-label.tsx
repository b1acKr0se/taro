/**
 * A one-line label in a chip, pill, badge or tab whose capitals sit on its line's middle, level with
 * the icon beside it, on the phone too (TR-092; why: `label-centre.ts`). Every font, size and font
 * scale is measured once, by the first label drawn with it, and the shift is reused by every other
 * label and every later draw, kept across reconnects; until that first measurement the labels wait
 * hidden, so nothing jumps when the board first draws or a count changes. The web reports no text
 * layout, and its labels are centred already, so there it is a plain `Text`.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { PixelRatio, Platform, StyleSheet, Text, type TextLayoutEventData, type NativeSyntheticEvent, type TextProps } from "react-native";

import { keptMap } from "./kept";
import { capCentreShift, createShiftStore, labelFontKey } from "./label-centre";

const shifts = createShiftStore(keptMap<string, number>(globalThis, "labelShifts.v1"));

/** Past this, a label never measured is shown where it is rather than kept hidden. */
const MEASURE_WAIT_MS = 400;

const HIDDEN = { opacity: 0 } as const;

export function CentredLabel(props: TextProps) {
  return Platform.OS === "web" ? <Text {...props} /> : <MeasuredLabel {...props} />;
}

function MeasuredLabel({ style, onTextLayout, ...rest }: TextProps) {
  const key = labelFontKey(StyleSheet.flatten(style) ?? {}, PixelRatio.getFontScale());
  const shift = useSyncExternalStore(shifts.subscribe, () => shifts.get(key));
  const [gaveUp, setGaveUp] = useState(false);
  const measuring = shift === undefined;
  useEffect(() => {
    if (!measuring) return;
    const timer = setTimeout(() => setGaveUp(true), MEASURE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [measuring, key]);

  function measure(event: NativeSyntheticEvent<TextLayoutEventData>) {
    const line = event.nativeEvent.lines[0];
    if (line !== undefined) shifts.set(key, capCentreShift(line));
    onTextLayout?.(event);
  }

  const placed = measuring ? (gaveUp ? null : HIDDEN) : shift === 0 ? null : { transform: [{ translateY: shift }] };
  return <Text {...rest} style={[style, placed]} onTextLayout={measuring ? measure : onTextLayout} />;
}
