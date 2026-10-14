/**
 * How tall the composer's field is (TR-039), ported from Paseo's `useComposerHeight`
 * (`packages/app/src/composer/input/height.web.ts` and `height.native.ts` at v0.11.2),
 * Copyright (c) 2025-present Mohamed Boudra, licensed under the Apache License, Version 2.0
 * (see THIRD_PARTY_NOTICES.md). Changed: the web and native variants are one hook choosing by
 * `Platform.OS` (a plugin's client is not resolved per platform), the DOM is reached through
 * `globalThis` (the client is typed without the DOM library), a computed style that lacks a
 * property copies as "", the bounds and the small rules come from `composer-height.ts` (tested
 * there), and instead of Paseo's `onTextChange` on each edit and `reset()` on send, the field is
 * measured in a layout effect whenever the draft changes, which also covers a draft restored or
 * switched from outside the field.
 *
 * On a phone the field grows by itself between its minimum and maximum, which is smooth because
 * nothing else sets its height. A browser's textarea does not grow, so a hidden copy of it takes
 * the draft and the field becomes as tall as the copy's content, before the frame is painted.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Platform } from "react-native";

import { boundedComposerHeight, composerScrollEnabled, measurableWidth, mirrorValue } from "./composer-height";

/** The parts of a DOM textarea and its computed style the measurement reads. */
interface DomStyle {
  [property: string]: string;
}
interface DomTextArea {
  clientWidth: number;
  scrollHeight: number;
  value: string;
  readOnly: boolean;
  rows: number;
  style: DomStyle;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
}
interface Dom {
  document?: { createElement: (tag: string) => DomTextArea; body: { appendChild: (node: DomTextArea) => void } };
  getComputedStyle?: (element: DomTextArea) => DomStyle;
  ResizeObserver?: new (callback: () => void) => { observe: (element: DomTextArea) => void; disconnect: () => void };
}

const COPIED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
  "wordBreak",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

export interface ComposerHeight {
  style: { height?: number; minHeight: number; maxHeight: number };
  scrollEnabled: boolean;
}

export function useComposerHeight({
  text,
  field,
  minHeight,
  maxHeight,
}: {
  /** The draft; measured again, before the frame is painted, whenever it changes. */
  text: string;
  /** On the web, React Native's TextInput ref is the DOM textarea itself. */
  field: RefObject<unknown>;
  minHeight: number;
  maxHeight: number;
}): ComposerHeight {
  const web = Platform.OS === "web";
  const [height, setHeight] = useState(minHeight);
  const heightRef = useRef(minHeight);
  const paramsRef = useRef({ text, minHeight, maxHeight });
  paramsRef.current = { text, minHeight, maxHeight };
  const mirrorRef = useRef<DomTextArea | null>(null);
  const dom = globalThis as unknown as Dom;

  const setBoundedHeight = useCallback((nextHeight: number) => {
    const bounded = boundedComposerHeight(nextHeight, paramsRef.current.minHeight, paramsRef.current.maxHeight);
    if (Math.abs(heightRef.current - bounded) < 1) return;
    heightRef.current = bounded;
    setHeight(bounded);
  }, []);

  const measure = useCallback(
    (draft: string) => {
      const mirror = mirrorRef.current;
      const source = field.current as DomTextArea | null;
      if (mirror === null || source === null || dom.getComputedStyle === undefined) return;
      const sourceWidth = source.clientWidth;
      if (!measurableWidth(sourceWidth)) return;
      const computedStyle = dom.getComputedStyle(source);
      for (const property of COPIED_STYLES) mirror.style[property] = computedStyle[property] ?? "";
      mirror.style.width = `${sourceWidth}px`;
      mirror.value = mirrorValue(draft);
      setBoundedHeight(mirror.scrollHeight);
    },
    [setBoundedHeight, field],
  );

  useEffect(() => {
    if (!web || dom.document === undefined) return;
    const mirror = dom.document.createElement("textarea");
    mirror.setAttribute("aria-hidden", "true");
    mirror.setAttribute("tabindex", "-1");
    mirror.readOnly = true;
    mirror.rows = 1;
    Object.assign(mirror.style, {
      position: "absolute",
      top: "0",
      left: "0",
      visibility: "hidden",
      pointerEvents: "none",
      overflow: "hidden",
      border: "0",
      margin: "0",
      resize: "none",
      zIndex: "-1",
      boxSizing: "border-box",
    });
    dom.document.body.appendChild(mirror);
    mirrorRef.current = mirror;
    measure(paramsRef.current.text);
    return () => {
      mirror.remove();
      mirrorRef.current = null;
    };
  }, [measure, web]);

  // Paseo measures in the change handler and resets on send; measuring on every new draft covers
  // typing, a paste, a send and a draft restored from another agent alike.
  useLayoutEffect(() => {
    if (web) measure(text);
  }, [maxHeight, minHeight, text, measure, web]);

  // A narrower or wider field wraps the same draft onto a different number of lines.
  useEffect(() => {
    const source = field.current as DomTextArea | null;
    if (!web || source === null || dom.ResizeObserver === undefined) return;
    let previousWidth = source.clientWidth;
    const observer = new dom.ResizeObserver(() => {
      const nextWidth = source.clientWidth;
      if (Math.abs(nextWidth - previousWidth) < 1) return;
      previousWidth = nextWidth;
      measure(paramsRef.current.text);
    });
    observer.observe(source);
    return () => observer.disconnect();
  }, [measure, field, web]);

  const style = useMemo(() => (web ? { height, minHeight, maxHeight } : { minHeight, maxHeight }), [web, height, minHeight, maxHeight]);
  return { style, scrollEnabled: web ? composerScrollEnabled(height, maxHeight) : true };
}
