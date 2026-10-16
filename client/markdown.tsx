/**
 * A small renderer for the Markdown an agent writes.
 *
 * A client bundle may import only the modules the host provides, so no
 * Markdown library is reachable, and the host has no renderer of its own to
 * lend. This covers what an agent's reply actually uses — headings,
 * lists, fenced code, quotes, rules, pipe tables, a line of images (an
 * image the agent read, `./image-view`), and bold, code and links inline,
 * with the home's files it names linked (`./file-links`) — and renders
 * anything else as a plain paragraph. It is a trimmed copy of
 * `github-board/client/markdown.tsx`, without the HTML and `<details>`
 * handling an issue body needs and an agent's reply does not; there is no
 * workspace root to share one from.
 *
 * Single newlines break lines, so a list the agent wrapped by hand keeps its
 * shape instead of reflowing.
 *
 * `foldParagraphs` (the Ticket tab, TR-061) shows a paragraph or list item past
 * about three lines as three, with "more" to unfold it; chat leaves it off.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";

import { focusRingStyle } from "./focus-ring";
import { ImageThumbnail } from "./image-view";
import { inlineTokens, type FileLookup } from "./file-links";
import { blockImages, parseMarkdownCached, type Block, type ImageReference } from "./markdown-parse";
import { MONOSPACE } from "./ui";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

interface MarkdownStyles {
  paragraph: object;
  heading: object;
  headingLarge: object;
  list: object;
  listRow: object;
  listMarker: object;
  listText: object;
  codeBlock: object;
  codeText: object;
  quote: object;
  rule: object;
  bold: object;
  inlineCode: object;
  link: object;
  table: object;
  tableRow: object;
  tableCell: object;
  tableHeader: object;
  images: object;
  more: object;
}

/** A folded paragraph shows this many lines; text shorter than the minimum never needs folding, so it is not measured. */
const FOLD_LINES = 3;
const FOLD_MIN_CHARACTERS = 120;

function useMarkdownStyles(theme: PluginTheme, fontSize: number): MarkdownStyles {
  return useMemo(
    () => ({
      paragraph: { color: theme.colors.foreground, fontSize, lineHeight: lineHeightFor(fontSize) },
      heading: { color: theme.colors.foreground, fontSize: fontSize + 1, fontWeight: "600" as const, marginTop: SPACE.sm },
      headingLarge: { color: theme.colors.foreground, fontSize: fontSize + 3, fontWeight: "700" as const, marginTop: SPACE.sm },
      list: { gap: SPACE.xs },
      listRow: { flexDirection: "row" as const, gap: SPACE.sm },
      listMarker: { color: theme.colors.foregroundMuted, fontSize, lineHeight: lineHeightFor(fontSize) },
      listText: { flex: 1 },
      codeBlock: {
        backgroundColor: theme.colors.surface2,
        borderRadius: 6,
        paddingHorizontal: SPACE.sm + 2,
        paddingVertical: SPACE.sm,
      },
      codeText: { color: theme.colors.foreground, fontFamily: MONOSPACE, fontSize: fontSize - 1 },
      quote: { borderLeftWidth: 3, borderLeftColor: theme.colors.border, paddingLeft: SPACE.sm + 2, gap: SPACE.sm + 2 },
      rule: { height: 1, backgroundColor: theme.colors.border, marginVertical: SPACE.xs },
      bold: { fontWeight: "700" as const },
      inlineCode: {
        fontFamily: MONOSPACE,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: fontSize - 1,
      },
      // A link and "more" are pressable text: the keyboard ring takes the accent too (TR-078).
      link: { color: theme.colors.accent, textDecorationLine: "underline" as const, ...focusRingStyle(theme.colors.accent, Platform.OS === "web") },
      table: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 },
      tableRow: { flexDirection: "row" as const, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
      tableCell: { flex: 1, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs },
      tableHeader: { fontWeight: "600" as const },
      images: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      more: { color: theme.colors.accent, fontSize: fontSize - 1, fontWeight: "600" as const, paddingTop: SPACE.xxs, alignSelf: "flex-start" as const, ...focusRingStyle(theme.colors.accent, Platform.OS === "web") },
    }),
    [theme, fontSize],
  );
}

const noFiles: FileLookup = () => null;

/** What a press on an inline link does, and which paths are files to link. */
interface InlineContext {
  theme: PluginTheme;
  lookup: FileLookup;
  onOpenLink: (url: string) => void;
  onOpenFile: ((path: string) => void) | null;
  /** Every image of the message, the set its enlarged view moves through. */
  images: ImageReference[];
  /** Long paragraphs and list items fold after `FOLD_LINES`. */
  fold: boolean;
  /** The text's line height, to tell how many lines a paragraph takes. */
  lineHeight: number;
}

/**
 * A paragraph that shows `FOLD_LINES` lines with "more" when it takes more. An unseen copy of the
 * whole text, laid out at the same width, tells its height; the frame clips it, so it neither shows
 * nor lengthens the scroll.
 */
function FoldingText({ style, lineHeight, moreStyle, children }: { style: object | object[]; lineHeight: number; moreStyle: object; children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const [open, setOpen] = useState(false);
  const long = height > lineHeight * (FOLD_LINES + 0.5);
  return (
    <View style={{ overflow: "hidden" }}>
      <Text selectable style={style} numberOfLines={long && !open ? FOLD_LINES : undefined}>
        {children}
      </Text>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", top: 0, left: 0, right: 0, opacity: 0 }}>
        <Text style={style} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          {children}
        </Text>
      </View>
      {long ? (
        <Text accessibilityRole="button" accessibilityState={{ expanded: open }} style={moreStyle} onPress={() => setOpen((current) => !current)}>
          {open ? "less" : "more"}
        </Text>
      ) : null}
    </View>
  );
}

/** A paragraph's text, folded when the context folds and it is long enough to need it. */
function paragraphText(text: string, style: object | object[], styles: MarkdownStyles, context: InlineContext, key?: number): ReactNode {
  if (context.fold && text.length >= FOLD_MIN_CHARACTERS) {
    return (
      <FoldingText key={key} style={style} lineHeight={context.lineHeight} moreStyle={styles.more}>
        {renderInline(text, styles, context)}
      </FoldingText>
    );
  }
  return (
    <Text key={key} selectable style={style}>
      {renderInline(text, styles, context)}
    </Text>
  );
}

function renderInline(text: string, styles: MarkdownStyles, context: InlineContext): ReactNode[] {
  // `.map` rather than a loop, because a link's press handler closes over its
  // target and a closure made in a `for…of` body captures the binding's final
  // value under Hermes.
  const { onOpenFile } = context;
  const lookup = onOpenFile === null ? noFiles : context.lookup;
  return inlineTokens(text, lookup).map((token, index) => {
    switch (token.kind) {
      case "text":
        return token.text;
      case "code":
        return (
          <Text key={index} style={styles.inlineCode}>
            {token.text}
          </Text>
        );
      case "bold":
        return (
          // inherits colour: renderInline's pieces sit inside the paragraph's Text (raw strings need one)
          <Text key={index} style={styles.bold}>
            {token.text}
          </Text>
        );
      case "file":
        return (
          <Text
            key={index}
            accessibilityRole="link"
            accessibilityHint={`Opens ${token.path} in Files`}
            style={token.code ? [styles.inlineCode, styles.link] : styles.link}
            onPress={() => onOpenFile?.(token.path)}
          >
            {token.text}
          </Text>
        );
      default:
        return (
          <Text key={index} accessibilityRole="link" style={styles.link} onPress={() => context.onOpenLink(token.url)}>
            {token.text}
          </Text>
        );
    }
  });
}

function renderBlocks(blocks: readonly Block[], styles: MarkdownStyles, context: InlineContext): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case "heading":
        return (
          <Text key={index} accessibilityRole="header" style={block.level <= 2 ? styles.headingLarge : styles.heading}>
            {renderInline(block.text, styles, context)}
          </Text>
        );
      case "list":
        return (
          <View key={index} style={styles.list}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={[styles.listRow, { paddingLeft: item.depth * 14 }]}>
                <Text style={styles.listMarker}>{item.marker}</Text>
                {context.fold ? (
                  <View style={styles.listText}>{paragraphText(item.text, styles.paragraph, styles, context)}</View>
                ) : (
                  <Text style={[styles.paragraph, styles.listText]}>{renderInline(item.text, styles, context)}</Text>
                )}
              </View>
            ))}
          </View>
        );
      case "code":
        return (
          <View key={index} style={styles.codeBlock}>
            <Text selectable style={styles.codeText}>
              {block.text}
            </Text>
          </View>
        );
      case "quote":
        return (
          <View key={index} style={styles.quote}>
            {renderBlocks(block.blocks, styles, context)}
          </View>
        );
      case "rule":
        return <View key={index} style={styles.rule} />;
      case "image":
        return (
          <View key={index} style={styles.images}>
            {block.images.map((image, imageIndex) => (
              <ImageThumbnail
                key={imageIndex}
                source={image.src}
                alt={image.alt}
                theme={context.theme}
                set={context.images.map((each) => ({ source: each.src, alt: each.alt }))}
                index={context.images.indexOf(image)}
                captioned
              />
            ))}
          </View>
        );
      case "table":
        return (
          <View key={index} style={styles.table}>
            {[block.header, ...block.rows].map((cells, rowIndex) => (
              <View key={rowIndex} style={styles.tableRow}>
                {cells.map((cell, cellIndex) => (
                  <View key={cellIndex} style={styles.tableCell}>
                    <Text style={[styles.paragraph, rowIndex === 0 ? styles.tableHeader : null]}>
                      {renderInline(cell, styles, context)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      default:
        return paragraphText(block.text, styles.paragraph, styles, context, index);
    }
  });
}

export function Markdown({
  source,
  theme,
  fontSize = FONT_SIZE.body,
  onOpenLink,
  files = noFiles,
  onOpenFile = null,
  foldParagraphs = false,
}: {
  source: string;
  theme: PluginTheme;
  fontSize?: number;
  onOpenLink: (url: string) => void;
  /** Which paths the text names are files in the home — see `./file-links`; none without `onOpenFile`. */
  files?: FileLookup;
  onOpenFile?: ((path: string) => void) | null;
  /** Fold paragraphs and list items past about three lines behind "more" (the Ticket tab). */
  foldParagraphs?: boolean;
}) {
  const styles = useMarkdownStyles(theme, fontSize);
  const blocks = useMemo(() => parseMarkdownCached(source), [source]);
  const images = useMemo(() => blockImages(blocks), [blocks]);
  // Blocks a little further apart than lines, so paragraphs and lists read as separate thoughts.
  return <View style={{ gap: SPACE.sm + 2 }}>{renderBlocks(blocks, styles, { theme, lookup: files, onOpenLink, onOpenFile, images, fold: foldParagraphs, lineHeight: lineHeightFor(fontSize) })}</View>;
}

/**
 * One line of Markdown's inline marks (bold, code, links) as text runs, to sit inside a `Text` that
 * gives it its style: a plan's bullet (TR-061) is a line, not a block.
 */
export function MarkdownInline({ text, theme, fontSize = FONT_SIZE.body, onOpenLink }: { text: string; theme: PluginTheme; fontSize?: number; onOpenLink: (url: string) => void }) {
  const styles = useMarkdownStyles(theme, fontSize);
  return <>{renderInline(text, styles, { theme, lookup: noFiles, onOpenLink, onOpenFile: null, images: [], fold: false, lineHeight: lineHeightFor(fontSize) })}</>;
}
