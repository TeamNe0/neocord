import { buildCustomId } from "@teamneo/neocord-routing";
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SelectMenuDefaultValueType,
  SeparatorSpacingSize,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APICheckboxComponent,
  type APICheckboxGroupComponent,
  type APIComponentInLabel,
  type APIComponentInMessageActionRow,
  type APIContainerComponent,
  type APIFileComponent,
  type APIFileUploadComponent,
  type APILabelComponent,
  type APIMediaGalleryComponent,
  type APIMessageComponentEmoji,
  type APIRadioGroupComponent,
  type APISectionComponent,
  type APISelectMenuComponent,
  type APISelectMenuDefaultValue,
  type APISelectMenuOption,
  type APISeparatorComponent,
  type APITextDisplayComponent,
  type APITextInputComponent,
  type APIThumbnailComponent,
  type AttachmentPayload,
  type ChannelType,
  type MessageMentionOptions,
} from "discord.js";
import {
  HOST,
  displayName,
  isInline,
  significantNodes,
  visibleNodes,
  type HostElement,
  type HostNode,
} from "./host.ts";
import type {
  AccentColor,
  EmojiInput,
  ModalOptions,
  ModalRenderResult,
  NamedColor,
  RenderResult,
} from "./types.ts";
import {
  assertLength,
  assertString,
  assertTypes,
  componentName,
  validateComponent,
  type RenderMode,
  type RenderedComponent,
} from "./validate.ts";

export type LiveHandler = (event: unknown) => unknown;

export interface LiveBinding {
  assign(node: HostElement, handler: LiveHandler): string;
}

interface SerializeContext {
  readonly mode: RenderMode;
  readonly ids: Set<number>;
  readonly customIds: Set<string>;
  readonly files: Map<string, Buffer>;
  readonly live: LiveBinding | null;
  count: number;
}

interface Segment {
  readonly text: string;
  readonly block: boolean;
  readonly collapsible: boolean;
}

const NAMED_COLORS: Readonly<Record<NamedColor, number>> = {
  blurple: 0x5865f2,
  green: 0x57f287,
  yellow: 0xfee75c,
  fuchsia: 0xeb459e,
  red: 0xed4245,
  white: 0xffffff,
  black: 0x000000,
};

const BUTTON_STYLES: Readonly<Record<string, ButtonStyle>> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
  premium: ButtonStyle.Premium,
};

const TIMESTAMP_STYLES: ReadonlySet<string> = new Set(["t", "T", "d", "D", "f", "F", "s", "S", "R"]);

const ATTACHMENT_NAME = /^[\w.-]+$/;
const CUSTOM_EMOJI = /^<(a?):(\w+):(\d+)>$/;
const SNOWFLAKE = /^\d{17,20}$/;

const TOP_LEVEL_TYPES = [
  ComponentType.ActionRow,
  ComponentType.Container,
  ComponentType.File,
  ComponentType.MediaGallery,
  ComponentType.Section,
  ComponentType.Separator,
  ComponentType.TextDisplay,
] as const;

const MODAL_TOP_LEVEL_TYPES = [ComponentType.Label, ComponentType.TextDisplay] as const;

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function createContext(mode: RenderMode, live: LiveBinding | null): SerializeContext {
  return { mode, ids: new Set(), customIds: new Set(), files: new Map(), live, count: 0 };
}

function propsOf<T>(node: HostElement): T {
  return node.props as T;
}

function finish<T extends RenderedComponent>(component: T, ctx: SerializeContext): T {
  const name = componentName(component);
  validateComponent(component, ctx.mode);

  if (component.id !== undefined && component.id !== 0) {
    if (ctx.ids.has(component.id)) {
      throw new Error(`${name} has a duplicate component id: ${component.id}.`);
    }
    ctx.ids.add(component.id);
  }

  if ("custom_id" in component) {
    if (ctx.customIds.has(component.custom_id)) {
      throw new Error(`${name} has a duplicate customId: ${component.custom_id}.`);
    }
    ctx.customIds.add(component.custom_id);
  }

  ctx.count += 1;
  if (ctx.count > 40 && ctx.mode === "message") {
    throw new Error("Message cannot contain more than 40 components.");
  }

  return component;
}

function assertNoChildren(node: HostElement): void {
  if (significantNodes(node.children).length > 0) {
    throw new Error(`${displayName(node.type)} does not accept children.`);
  }
}

function normalizeEmoji(input: EmojiInput, owner: string): APIMessageComponentEmoji {
  if (typeof input === "string") {
    const custom = CUSTOM_EMOJI.exec(input);
    if (custom !== null) {
      const [, animated, name, id] = custom;
      return compact({ name, id, animated: animated === "a" ? true : undefined });
    }
    if (input === "") throw new Error(`${owner} emoji cannot be empty.`);
    return SNOWFLAKE.test(input) ? { id: input } : { name: input };
  }
  if (input === null || typeof input !== "object" || (input.id === undefined && input.name === undefined)) {
    throw new Error(`${owner} emoji must be a string or an object with an id or name.`);
  }
  return compact({ id: input.id, name: input.name, animated: input.animated });
}

function formatEmoji(input: EmojiInput): string {
  const emoji = normalizeEmoji(input, "Emoji");
  if (emoji.id === undefined) return emoji.name ?? "";
  return `<${emoji.animated === true ? "a" : ""}:${emoji.name ?? "emoji"}:${emoji.id}>`;
}

function collapseWhitespaceAroundBlocks(segments: readonly Segment[]): Segment[] {
  return segments.filter((segment, index) => {
    if (!segment.collapsible || !/^[ \t]*$/.test(segment.text)) return true;
    return !(segments[index - 1]?.block === true || segments[index + 1]?.block === true);
  });
}

function joinSegments(segments: readonly Segment[]): string {
  let output = "";
  let previousBlock = false;

  for (const segment of collapseWhitespaceAroundBlocks(segments)) {
    if (segment.text === "") continue;
    const needsBreak = output !== "" && (segment.block || previousBlock);
    if (needsBreak && !output.endsWith("\n") && !segment.text.startsWith("\n")) output += "\n";
    output += segment.text;
    previousBlock = segment.block;
  }

  return output;
}

function renderInlineNodes(nodes: readonly HostNode[], parent: string): string {
  return joinSegments(visibleNodes(nodes).map((node) => renderSegment(node, parent)));
}

function wrap(node: HostElement, marker: string): Segment {
  const inner = renderInlineNodes(node.children, displayName(node.type));
  return { text: inner === "" ? "" : `${marker}${inner}${marker}`, block: false, collapsible: false };
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function renderCode(node: HostElement): Segment {
  const inner = renderInlineNodes(node.children, "Code");
  if (inner === "") return { text: "", block: false, collapsible: false };
  const text = inner.includes("`") ? `\`\` ${inner} \`\`` : `\`${inner}\``;
  return { text, block: false, collapsible: false };
}

function renderCodeBlock(node: HostElement): Segment {
  const { language } = propsOf<{ language?: string }>(node);
  const inner = renderInlineNodes(node.children, "CodeBlock");
  const body = inner.endsWith("\n") ? inner : `${inner}\n`;
  return { text: `\`\`\`${language ?? ""}\n${body}\`\`\``, block: true, collapsible: false };
}

function renderHeading(node: HostElement): Segment {
  const { level = 1 } = propsOf<{ level?: number }>(node);
  if (level !== 1 && level !== 2 && level !== 3) {
    throw new Error("Heading level must be 1, 2 or 3.");
  }
  const inner = renderInlineNodes(node.children, "Heading").replaceAll("\n", " ").trim();
  return { text: inner === "" ? "" : `${"#".repeat(level)} ${inner}`, block: true, collapsible: false };
}

function renderLink(node: HostElement): Segment {
  const { href } = propsOf<{ href?: unknown }>(node);
  assertString(href, "Link href", 1, 2048);
  const inner = renderInlineNodes(node.children, "Link");
  return { text: inner === "" ? href : `[${inner}](${href})`, block: false, collapsible: false };
}

function renderList(node: HostElement): Segment {
  const { ordered } = propsOf<{ ordered?: boolean }>(node);
  const items = significantNodes(node.children);
  const lines = items.map((item, index) => {
    if (item.kind !== "element" || item.type !== HOST.listItem) {
      throw new Error(`List children must be ListItem, received ${describeNode(item)}.`);
    }
    const marker = ordered === true ? `${index + 1}. ` : "- ";
    const [first = "", ...rest] = renderInlineNodes(item.children, "ListItem").trim().split("\n");
    return [`${marker}${first}`, ...rest.map((line) => `${" ".repeat(marker.length)}${line}`)].join("\n");
  });
  return { text: lines.join("\n"), block: true, collapsible: false };
}

function renderMention(node: HostElement, prefix: string): Segment {
  const name = displayName(node.type);
  const { id } = propsOf<{ id?: unknown }>(node);
  assertString(id, `${name} id`, 1, 20);
  return { text: `<${prefix}${id}>`, block: false, collapsible: false };
}

function renderTimestamp(node: HostElement): Segment {
  const { date, style } = propsOf<{ date?: Date | number | string; style?: string }>(node);
  const milliseconds = date instanceof Date ? date.getTime() : new Date(date ?? Number.NaN).getTime();
  if (Number.isNaN(milliseconds)) {
    throw new Error("Timestamp date must be a Date, a millisecond number or a date string.");
  }
  if (style !== undefined && !TIMESTAMP_STYLES.has(style)) {
    throw new Error(`Timestamp style must be one of ${[...TIMESTAMP_STYLES].join(", ")}.`);
  }
  const seconds = Math.floor(milliseconds / 1000);
  return {
    text: style === undefined ? `<t:${seconds}>` : `<t:${seconds}:${style}>`,
    block: false,
    collapsible: false,
  };
}

function renderEmoji(node: HostElement): Segment {
  const { emoji, name, id, animated } = propsOf<{
    emoji?: EmojiInput;
    name?: string;
    id?: string;
    animated?: boolean;
  }>(node);
  return {
    text: formatEmoji(emoji ?? { name, id, animated }),
    block: false,
    collapsible: false,
  };
}

function renderSegment(node: HostNode, parent: string): Segment {
  if (node.kind === "text") return { text: node.text, block: false, collapsible: true };

  switch (node.type) {
    case HOST.bold:
      return wrap(node, "**");
    case HOST.italic:
      return wrap(node, "*");
    case HOST.underline:
      return wrap(node, "__");
    case HOST.strikethrough:
      return wrap(node, "~~");
    case HOST.spoiler:
      return wrap(node, "||");
    case HOST.code:
      return renderCode(node);
    case HOST.codeBlock:
      return renderCodeBlock(node);
    case HOST.quote: {
      const inner = renderInlineNodes(node.children, "Quote");
      return { text: inner === "" ? "" : prefixLines(inner, "> "), block: true, collapsible: false };
    }
    case HOST.heading:
      return renderHeading(node);
    case HOST.subtext: {
      const inner = renderInlineNodes(node.children, "Subtext");
      return { text: inner === "" ? "" : prefixLines(inner, "-# "), block: true, collapsible: false };
    }
    case HOST.link:
      return renderLink(node);
    case HOST.list:
      return renderList(node);
    case HOST.userMention:
      return renderMention(node, "@");
    case HOST.roleMention:
      return renderMention(node, "@&");
    case HOST.channelMention:
      return renderMention(node, "#");
    case HOST.timestamp:
      return renderTimestamp(node);
    case HOST.emoji:
      return renderEmoji(node);
    case HOST.lineBreak:
      return { text: "\n", block: false, collapsible: false };
    case HOST.listItem:
      throw new Error("ListItem must be inside List.");
    default:
      throw new Error(`${describeNode(node)} is not allowed inside ${parent}.`);
  }
}

function describeNode(node: HostNode): string {
  return node.kind === "text" ? "text" : displayName(node.type);
}

function renderPlainText(nodes: readonly HostNode[], owner: string): string {
  let text = "";
  for (const node of visibleNodes(nodes)) {
    if (node.kind !== "text") {
      throw new Error(`${owner} children must be text, received ${displayName(node.type)}.`);
    }
    text += node.text;
  }
  return text;
}

function textDisplay(content: string, id: number | undefined, ctx: SerializeContext): APITextDisplayComponent {
  return finish(compact({ type: ComponentType.TextDisplay as const, content, id }), ctx);
}

function serializeCollapsed(nodes: readonly HostNode[], parent: string, ctx: SerializeContext): RenderedComponent[] {
  const components: RenderedComponent[] = [];
  let run: HostNode[] = [];

  const flushRun = (): void => {
    if (run.length === 0) return;
    const content = renderInlineNodes(run, parent).trim();
    run = [];
    if (content !== "") components.push(textDisplay(content, undefined, ctx));
  };

  for (const node of visibleNodes(nodes)) {
    if (isInline(node)) {
      run.push(node);
    } else {
      flushRun();
      components.push(serializeBlock(node as HostElement, ctx));
    }
  }
  flushRun();

  return components;
}

function serializeStrict(nodes: readonly HostNode[], parent: string, ctx: SerializeContext): RenderedComponent[] {
  return significantNodes(nodes).map((node) => {
    if (isInline(node)) {
      throw new Error(`${describeNode(node)} is not allowed inside ${parent}.`);
    }
    return serializeBlock(node as HostElement, ctx);
  });
}

function resolveCustomId(
  node: HostElement,
  handlerProp: "onClick" | "onSelect",
  ctx: SerializeContext,
): string {
  const name = displayName(node.type);
  const props = node.props as {
    route?: string;
    params?: Record<string, unknown>;
    customId?: string;
  } & Record<string, unknown>;
  const handler = props[handlerProp];
  const modes = [props.route, props.customId, handler].filter((value) => value !== undefined);

  if (modes.length > 1) {
    throw new Error(`${name} accepts only one of route, customId or ${handlerProp}.`);
  }
  if (modes.length === 0) {
    throw new Error(`${name} requires one of route, customId or ${handlerProp}.`);
  }
  if (props.params !== undefined && props.route === undefined) {
    throw new Error(`${name} params can only be used with route.`);
  }

  if (handler !== undefined) {
    if (typeof handler !== "function") {
      throw new Error(`${name} ${handlerProp} must be a function.`);
    }
    if (ctx.live === null) {
      throw new Error(
        `${name} has an ${handlerProp} handler, which needs a live session. Send it with ctx.reply or render it with createLiveRoot, or address a handler file with route or customId.`,
      );
    }
    return ctx.live.assign(node, handler as LiveHandler);
  }

  if (props.route !== undefined) return buildCustomId(props.route, props.params);

  return assertUserCustomId(props.customId, name);
}

function assertUserCustomId(customId: unknown, name: string): string {
  assertString(customId, `${name} customId`, 1, 100);
  if (customId.startsWith("~")) {
    throw new Error(`${name} customId cannot start with "~", which is reserved for live sessions.`);
  }
  return customId;
}

function serializeButton(node: HostElement, ctx: SerializeContext): APIButtonComponent {
  const props = propsOf<{
    id?: number;
    style?: string;
    label?: string;
    emoji?: EmojiInput;
    disabled?: boolean;
    url?: string;
    skuId?: string;
  }>(node);
  const style = BUTTON_STYLES[props.style ?? "secondary"];
  if (style === undefined) {
    throw new Error(`Button style must be one of ${Object.keys(BUTTON_STYLES).join(", ")}.`);
  }

  const hasChildren = significantNodes(node.children).length > 0;

  if (style === ButtonStyle.Premium) {
    if (hasChildren) throw new Error("Button with style premium cannot have children.");
    if (props.label !== undefined) throw new Error("Button with style premium cannot have a label.");
    if (props.emoji !== undefined) throw new Error("Button with style premium cannot have an emoji.");
    if (props.url !== undefined) throw new Error("Button with style premium cannot have a url.");
    const { route, customId, onClick } = propsOf<{ route?: unknown; customId?: unknown; onClick?: unknown }>(node);
    if (route !== undefined || customId !== undefined || onClick !== undefined) {
      throw new Error("Button with style premium cannot have route, customId or onClick.");
    }
    return finish(
      compact({
        type: ComponentType.Button as const,
        style,
        sku_id: props.skuId as string,
        disabled: props.disabled,
        id: props.id,
      }),
      ctx,
    );
  }

  if (hasChildren && props.label !== undefined) {
    throw new Error("Button accepts either label or children, not both.");
  }

  const label = hasChildren ? renderPlainText(node.children, "Button") : props.label;
  const emoji = props.emoji === undefined ? undefined : normalizeEmoji(props.emoji, "Button");

  if (style === ButtonStyle.Link) {
    const { route, customId, onClick } = propsOf<{ route?: unknown; customId?: unknown; onClick?: unknown }>(node);
    if (route !== undefined || customId !== undefined || onClick !== undefined || props.skuId !== undefined) {
      throw new Error("Button with style link cannot have route, customId, onClick or skuId.");
    }
    return finish(
      compact({
        type: ComponentType.Button as const,
        style,
        url: props.url as string,
        label,
        emoji,
        disabled: props.disabled,
        id: props.id,
      }),
      ctx,
    );
  }

  if (props.url !== undefined || props.skuId !== undefined) {
    throw new Error(`Button with style ${props.style ?? "secondary"} cannot have a url or skuId.`);
  }

  return finish(
    compact({
      type: ComponentType.Button as const,
      style,
      custom_id: resolveCustomId(node, "onClick", ctx),
      label,
      emoji,
      disabled: props.disabled,
      id: props.id,
    }),
    ctx,
  );
}

interface RawOption {
  label: string;
  value: string;
  description?: string;
  emoji?: EmojiInput;
  default?: boolean;
}

function readOptions(node: HostElement, allowEmoji: boolean): APISelectMenuOption[] {
  const name = displayName(node.type);
  const { options } = propsOf<{ options?: readonly RawOption[] }>(node);
  const children = significantNodes(node.children);

  if (options !== undefined && children.length > 0) {
    throw new Error(`${name} accepts either options or Option children, not both.`);
  }

  const raw: readonly RawOption[] =
    options ??
    children.map((child) => {
      if (child.kind !== "element" || child.type !== HOST.option) {
        throw new Error(`${describeNode(child)} is not allowed inside ${name}. Use Option.`);
      }
      assertNoChildren(child);
      return propsOf<RawOption>(child);
    });

  return raw.map((option) => {
    if (!allowEmoji && option.emoji !== undefined) {
      throw new Error(`${name} options do not support emoji.`);
    }
    return compact({
      label: option.label,
      value: option.value,
      description: option.description,
      emoji: option.emoji === undefined ? undefined : normalizeEmoji(option.emoji, `${name} option`),
      default: option.default,
    });
  });
}

function selectBase(node: HostElement, ctx: SerializeContext) {
  const props = propsOf<{
    id?: number;
    placeholder?: string;
    minValues?: number;
    maxValues?: number;
    disabled?: boolean;
    required?: boolean;
  }>(node);
  return {
    custom_id: resolveCustomId(node, "onSelect", ctx),
    placeholder: props.placeholder,
    min_values: props.minValues,
    max_values: props.maxValues,
    disabled: props.disabled,
    required: props.required,
    id: props.id,
  };
}

function readDefaultValues<T extends SelectMenuDefaultValueType>(
  node: HostElement,
  inferred: T | null,
): APISelectMenuDefaultValue<T>[] | undefined {
  const { defaultValues } = propsOf<{
    defaultValues?: readonly (string | { id: string; type: T })[];
  }>(node);
  if (defaultValues === undefined) return undefined;
  return defaultValues.map((value) => {
    if (typeof value !== "string") return { id: value.id, type: value.type };
    if (inferred === null) {
      throw new Error(`${displayName(node.type)} defaultValues must be objects with an id and type.`);
    }
    return { id: value, type: inferred };
  });
}

function serializeStringSelect(node: HostElement, ctx: SerializeContext): APISelectMenuComponent {
  return finish(
    compact({
      type: ComponentType.StringSelect as const,
      ...selectBase(node, ctx),
      options: readOptions(node, true),
    }),
    ctx,
  );
}

function serializeUserSelect(node: HostElement, ctx: SerializeContext): APISelectMenuComponent {
  assertNoChildren(node);
  return finish(
    compact({
      type: ComponentType.UserSelect as const,
      ...selectBase(node, ctx),
      default_values: readDefaultValues(node, SelectMenuDefaultValueType.User),
    }),
    ctx,
  );
}

function serializeRoleSelect(node: HostElement, ctx: SerializeContext): APISelectMenuComponent {
  assertNoChildren(node);
  return finish(
    compact({
      type: ComponentType.RoleSelect as const,
      ...selectBase(node, ctx),
      default_values: readDefaultValues(node, SelectMenuDefaultValueType.Role),
    }),
    ctx,
  );
}

function serializeMentionableSelect(node: HostElement, ctx: SerializeContext): APISelectMenuComponent {
  assertNoChildren(node);
  return finish(
    compact({
      type: ComponentType.MentionableSelect as const,
      ...selectBase(node, ctx),
      default_values: readDefaultValues<SelectMenuDefaultValueType.Role | SelectMenuDefaultValueType.User>(node, null),
    }),
    ctx,
  );
}

function serializeChannelSelect(node: HostElement, ctx: SerializeContext): APISelectMenuComponent {
  assertNoChildren(node);
  const { channelTypes } = propsOf<{ channelTypes?: readonly ChannelType[] }>(node);
  return finish(
    compact({
      type: ComponentType.ChannelSelect as const,
      ...selectBase(node, ctx),
      default_values: readDefaultValues(node, SelectMenuDefaultValueType.Channel),
      channel_types: channelTypes === undefined ? undefined : [...channelTypes],
    }),
    ctx,
  );
}

function resolveColor(color: AccentColor): number {
  if (typeof color === "number") return color;
  if (color.startsWith("#")) {
    if (!/^#[\da-f]{6}$/i.test(color)) {
      throw new Error(`Container accentColor "${color}" must use the #rrggbb format.`);
    }
    return Number.parseInt(color.slice(1), 16);
  }
  const named = (NAMED_COLORS as Readonly<Record<string, number>>)[color];
  if (named === undefined) {
    throw new Error(
      `Container accentColor "${color}" must be a number, #rrggbb or one of ${Object.keys(NAMED_COLORS).join(", ")}.`,
    );
  }
  return named;
}

function serializeContainer(node: HostElement, ctx: SerializeContext): APIContainerComponent {
  const props = propsOf<{ id?: number; accentColor?: AccentColor; spoiler?: boolean }>(node);
  const components = assertTypes(
    serializeCollapsed(node.children, "Container", ctx),
    [
      ComponentType.ActionRow,
      ComponentType.TextDisplay,
      ComponentType.Section,
      ComponentType.MediaGallery,
      ComponentType.Separator,
      ComponentType.File,
    ],
    "Container",
  );
  return finish(
    compact({
      type: ComponentType.Container as const,
      components: components as APIContainerComponent["components"],
      spoiler: props.spoiler ?? false,
      accent_color: props.accentColor === undefined ? undefined : resolveColor(props.accentColor),
      id: props.id,
    }),
    ctx,
  );
}

function serializeActionRow(
  node: HostElement,
  ctx: SerializeContext,
): APIActionRowComponent<APIComponentInMessageActionRow> {
  const { id } = propsOf<{ id?: number }>(node);
  const components = assertTypes(
    serializeStrict(node.children, "ActionRow", ctx),
    [
      ComponentType.Button,
      ComponentType.StringSelect,
      ComponentType.UserSelect,
      ComponentType.RoleSelect,
      ComponentType.MentionableSelect,
      ComponentType.ChannelSelect,
    ],
    "ActionRow",
  );
  assertLength(components, "ActionRow children", 1, 5);
  if (components.some((component) => component.type !== ComponentType.Button) && components.length !== 1) {
    throw new Error("ActionRow must contain up to five buttons or a single select.");
  }
  return finish(compact({ type: ComponentType.ActionRow as const, components, id }), ctx);
}

function serializeSection(node: HostElement, ctx: SerializeContext): APISectionComponent {
  const { id } = propsOf<{ id?: number }>(node);
  const slot = node.children.find((child) => child.kind === "element" && child.type === HOST.accessory);
  const body = node.children.filter((child) => child !== slot);
  const components = assertTypes(
    serializeCollapsed(body, "Section", ctx),
    [ComponentType.TextDisplay],
    "Section",
  );
  assertLength(components, "Section text children", 1, 3);
  const accessories = assertTypes(
    serializeStrict(slot?.kind === "element" ? slot.children : [], "Section accessory", ctx),
    [ComponentType.Button, ComponentType.Thumbnail],
    "Section accessory",
  );
  assertLength(accessories, "Section accessory", 1, 1);
  const [accessory] = accessories;
  if (accessory === undefined) throw new Error("Section accessory must contain exactly 1 item.");
  return finish(compact({ type: ComponentType.Section as const, components, accessory, id }), ctx);
}

function resolveMediaUrl(
  src: unknown,
  name: string | undefined,
  owner: string,
  ctx: SerializeContext,
): string {
  if (typeof src === "string") return src;
  if (!(src instanceof Uint8Array)) {
    throw new Error(`${owner} src must be a URL, an attachment:// reference, a Buffer or a Uint8Array.`);
  }
  if (name === undefined) {
    throw new Error(`${owner} requires a name when src is a Buffer or Uint8Array.`);
  }
  if (!ATTACHMENT_NAME.test(name)) {
    throw new Error(`${owner} name "${name}" may only contain letters, numbers, underscores, dashes and dots.`);
  }
  const buffer = Buffer.isBuffer(src) ? src : Buffer.from(src.buffer, src.byteOffset, src.byteLength);
  const existing = ctx.files.get(name);
  if (existing !== undefined && !existing.equals(buffer)) {
    throw new Error(`${owner} name "${name}" is already used by a different attachment.`);
  }
  ctx.files.set(name, buffer);
  return `attachment://${name}`;
}

function serializeThumbnail(node: HostElement, ctx: SerializeContext): APIThumbnailComponent {
  assertNoChildren(node);
  const props = propsOf<{
    id?: number;
    src?: unknown;
    name?: string;
    description?: string;
    spoiler?: boolean;
  }>(node);
  return finish(
    compact({
      type: ComponentType.Thumbnail as const,
      media: { url: resolveMediaUrl(props.src, props.name, "Thumbnail", ctx) },
      description: props.description,
      spoiler: props.spoiler,
      id: props.id,
    }),
    ctx,
  );
}

function serializeMediaGallery(node: HostElement, ctx: SerializeContext): APIMediaGalleryComponent {
  const props = propsOf<{
    id?: number;
    items?: readonly { src: unknown; name?: string; description?: string; spoiler?: boolean }[];
  }>(node);
  const children = significantNodes(node.children);
  if (props.items !== undefined && children.length > 0) {
    throw new Error("MediaGallery accepts either items or MediaItem children, not both.");
  }

  const raw =
    props.items ??
    children.map((child) => {
      if (child.kind !== "element" || child.type !== HOST.mediaItem) {
        throw new Error(`${describeNode(child)} is not allowed inside MediaGallery. Use MediaItem.`);
      }
      assertNoChildren(child);
      return propsOf<{ src: unknown; name?: string; description?: string; spoiler?: boolean }>(child);
    });

  return finish(
    compact({
      type: ComponentType.MediaGallery as const,
      items: raw.map((item) =>
        compact({
          media: { url: resolveMediaUrl(item.src, item.name, "MediaItem", ctx) },
          description: item.description,
          spoiler: item.spoiler,
        }),
      ),
      id: props.id,
    }),
    ctx,
  );
}

function serializeFile(node: HostElement, ctx: SerializeContext): APIFileComponent {
  assertNoChildren(node);
  const props = propsOf<{ id?: number; src?: unknown; name?: string; spoiler?: boolean }>(node);
  return finish(
    compact({
      type: ComponentType.File as const,
      file: { url: resolveMediaUrl(props.src, props.name, "File", ctx) },
      spoiler: props.spoiler,
      id: props.id,
    }),
    ctx,
  );
}

function serializeSeparator(node: HostElement, ctx: SerializeContext): APISeparatorComponent {
  assertNoChildren(node);
  const props = propsOf<{ id?: number; divider?: boolean; spacing?: string }>(node);
  if (props.spacing !== undefined && props.spacing !== "small" && props.spacing !== "large") {
    throw new Error("Separator spacing must be small or large.");
  }
  return finish(
    compact({
      type: ComponentType.Separator as const,
      divider: props.divider ?? true,
      spacing: props.spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small,
      id: props.id,
    }),
    ctx,
  );
}

function serializeTextDisplay(node: HostElement, ctx: SerializeContext): APITextDisplayComponent {
  const { id } = propsOf<{ id?: number }>(node);
  return textDisplay(renderInlineNodes(node.children, "TextDisplay"), id, ctx);
}

function serializeLabel(node: HostElement, ctx: SerializeContext): APILabelComponent {
  const props = propsOf<{ id?: number; label?: string; description?: string }>(node);
  const components = assertTypes(
    serializeStrict(node.children, "Label", ctx),
    [
      ComponentType.TextInput,
      ComponentType.StringSelect,
      ComponentType.UserSelect,
      ComponentType.RoleSelect,
      ComponentType.MentionableSelect,
      ComponentType.ChannelSelect,
      ComponentType.FileUpload,
      ComponentType.RadioGroup,
      ComponentType.CheckboxGroup,
      ComponentType.Checkbox,
    ],
    "Label",
  );
  assertLength(components, "Label children", 1, 1);
  const [component] = components;
  if (component === undefined) throw new Error("Label children must contain exactly 1 item.");
  return finish(
    compact({
      type: ComponentType.Label as const,
      label: props.label as string,
      description: props.description,
      component: component as APIComponentInLabel,
      id: props.id,
    }),
    ctx,
  );
}

function serializeTextInput(node: HostElement, ctx: SerializeContext): APITextInputComponent {
  const props = propsOf<{
    id?: number;
    customId?: unknown;
    style?: string;
    placeholder?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    value?: string;
  }>(node);
  if (props.style !== undefined && props.style !== "short" && props.style !== "paragraph") {
    throw new Error("TextInput style must be short or paragraph.");
  }
  const hasChildren = significantNodes(node.children).length > 0;
  if (hasChildren && props.value !== undefined) {
    throw new Error("TextInput accepts either value or children, not both.");
  }
  return finish(
    compact({
      type: ComponentType.TextInput as const,
      custom_id: assertUserCustomId(props.customId, "TextInput"),
      style: props.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short,
      placeholder: props.placeholder,
      required: props.required,
      min_length: props.minLength,
      max_length: props.maxLength,
      value: hasChildren ? renderPlainText(node.children, "TextInput") : props.value,
      id: props.id,
    }),
    ctx,
  );
}

function serializeFileUpload(node: HostElement, ctx: SerializeContext): APIFileUploadComponent {
  assertNoChildren(node);
  const props = propsOf<{
    id?: number;
    customId?: unknown;
    minValues?: number;
    maxValues?: number;
    fileTypes?: APIFileUploadComponent["file_types"];
    required?: boolean;
  }>(node);
  return finish(
    compact({
      type: ComponentType.FileUpload as const,
      custom_id: assertUserCustomId(props.customId, "FileUpload"),
      min_values: props.minValues,
      max_values: props.maxValues,
      file_types: props.fileTypes,
      required: props.required,
      id: props.id,
    }),
    ctx,
  );
}

function serializeRadioGroup(node: HostElement, ctx: SerializeContext): APIRadioGroupComponent {
  const props = propsOf<{ id?: number; customId?: unknown; required?: boolean }>(node);
  return finish(
    compact({
      type: ComponentType.RadioGroup as const,
      custom_id: assertUserCustomId(props.customId, "RadioGroup"),
      options: readOptions(node, false),
      required: props.required,
      id: props.id,
    }),
    ctx,
  );
}

function serializeCheckboxGroup(node: HostElement, ctx: SerializeContext): APICheckboxGroupComponent {
  const props = propsOf<{
    id?: number;
    customId?: unknown;
    minValues?: number;
    maxValues?: number;
    required?: boolean;
  }>(node);
  return finish(
    compact({
      type: ComponentType.CheckboxGroup as const,
      custom_id: assertUserCustomId(props.customId, "CheckboxGroup"),
      options: readOptions(node, false),
      min_values: props.minValues,
      max_values: props.maxValues,
      required: props.required,
      id: props.id,
    }),
    ctx,
  );
}

function serializeCheckbox(node: HostElement, ctx: SerializeContext): APICheckboxComponent {
  assertNoChildren(node);
  const props = propsOf<{ id?: number; customId?: unknown; default?: boolean }>(node);
  return finish(
    compact({
      type: ComponentType.Checkbox as const,
      custom_id: assertUserCustomId(props.customId, "Checkbox"),
      default: props.default,
      id: props.id,
    }),
    ctx,
  );
}

function serializeBlock(node: HostElement, ctx: SerializeContext): RenderedComponent {
  switch (node.type) {
    case HOST.container:
      return serializeContainer(node, ctx);
    case HOST.section:
      return serializeSection(node, ctx);
    case HOST.textDisplay:
      return serializeTextDisplay(node, ctx);
    case HOST.separator:
      return serializeSeparator(node, ctx);
    case HOST.actionRow:
      return serializeActionRow(node, ctx);
    case HOST.mediaGallery:
      return serializeMediaGallery(node, ctx);
    case HOST.thumbnail:
      return serializeThumbnail(node, ctx);
    case HOST.file:
      return serializeFile(node, ctx);
    case HOST.button:
      return serializeButton(node, ctx);
    case HOST.stringSelect:
      return serializeStringSelect(node, ctx);
    case HOST.userSelect:
      return serializeUserSelect(node, ctx);
    case HOST.roleSelect:
      return serializeRoleSelect(node, ctx);
    case HOST.mentionableSelect:
      return serializeMentionableSelect(node, ctx);
    case HOST.channelSelect:
      return serializeChannelSelect(node, ctx);
    case HOST.label:
      return serializeLabel(node, ctx);
    case HOST.textInput:
      return serializeTextInput(node, ctx);
    case HOST.fileUpload:
      return serializeFileUpload(node, ctx);
    case HOST.radioGroup:
      return serializeRadioGroup(node, ctx);
    case HOST.checkboxGroup:
      return serializeCheckboxGroup(node, ctx);
    case HOST.checkbox:
      return serializeCheckbox(node, ctx);
    case HOST.message:
      throw new Error("Message must be the root of the tree.");
    case HOST.modal:
      throw new Error("Modal must be the root of the tree passed to renderModal.");
    case HOST.option:
      throw new Error("Option must be inside StringSelect, RadioGroup or CheckboxGroup.");
    case HOST.mediaItem:
      throw new Error("MediaItem must be inside MediaGallery.");
    default:
      throw new Error(`Unsupported element ${displayName(node.type)}. Use components exported by @teamneo/neocord-react.`);
  }
}

function collectFiles(ctx: SerializeContext): AttachmentPayload[] {
  return [...ctx.files].map(([name, attachment]) => ({ attachment, name }));
}

export interface SerializeMessageOptions {
  live?: LiveBinding;
  allowEmpty?: boolean;
}

export function serializeMessage(
  rootNodes: readonly HostNode[],
  options: SerializeMessageOptions = {},
): RenderResult {
  const ctx = createContext("message", options.live ?? null);
  const roots = significantNodes(rootNodes);
  const messageRoot = roots.find((node) => node.kind === "element" && node.type === HOST.message);
  const modalRoot = roots.find((node) => node.kind === "element" && node.type === HOST.modal);

  if (modalRoot !== undefined) {
    throw new Error("Modal must be rendered with renderModal.");
  }
  if (messageRoot !== undefined && roots.length > 1) {
    throw new Error("Message must be the only element at the root of the tree.");
  }

  const message = messageRoot?.kind === "element" ? messageRoot : null;
  const props = message === null ? {} : propsOf<{ ephemeral?: boolean; allowedMentions?: MessageMentionOptions }>(message);
  const components = assertTypes(
    serializeCollapsed(message === null ? rootNodes : message.children, "Message", ctx),
    TOP_LEVEL_TYPES,
    "Message",
  );

  if (components.length === 0 && options.allowEmpty !== true) {
    throw new Error("Message must contain at least one component.");
  }

  const flags = props.ephemeral === true
    ? ((MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as RenderResult["flags"])
    : MessageFlags.IsComponentsV2;

  const result: RenderResult = {
    flags,
    components: components as RenderResult["components"],
  };
  const files = collectFiles(ctx);
  if (files.length > 0) result.files = files;
  if (props.allowedMentions !== undefined) result.allowedMentions = props.allowedMentions;
  return result;
}

export function serializeModal(
  rootNodes: readonly HostNode[],
  options: Partial<ModalOptions> = {},
): ModalRenderResult {
  const ctx = createContext("modal", null);
  const roots = significantNodes(rootNodes);
  const modalRoot = roots.find((node) => node.kind === "element" && node.type === HOST.modal);
  const messageRoot = roots.find((node) => node.kind === "element" && node.type === HOST.message);

  if (messageRoot !== undefined) {
    throw new Error("Message cannot be rendered with renderModal. Use render instead.");
  }
  if (modalRoot !== undefined && roots.length > 1) {
    throw new Error("Modal must be the only element at the root of the tree.");
  }

  const modal = modalRoot?.kind === "element" ? modalRoot : null;
  const props = modal === null
    ? {}
    : propsOf<{ title?: string; customId?: string; route?: string; params?: Record<string, unknown> }>(modal);

  if (props.customId !== undefined && props.route !== undefined) {
    throw new Error("Modal accepts either route or customId, not both.");
  }
  if (props.params !== undefined && props.route === undefined) {
    throw new Error("Modal params can only be used with route.");
  }

  const customId = props.route !== undefined
    ? buildCustomId(props.route, props.params)
    : (props.customId ?? options.customId);
  const title = props.title ?? options.title;

  if (customId === undefined || title === undefined) {
    throw new Error("renderModal requires a customId and title, either as options or on a root Modal.");
  }

  const id = assertUserCustomId(customId, "Modal");
  assertString(title, "Modal title", 1, 45);

  const components = assertTypes(
    serializeCollapsed(modal === null ? rootNodes : modal.children, "Modal", ctx),
    MODAL_TOP_LEVEL_TYPES,
    "Modal",
  );
  assertLength(components, "Modal components", 1, 5);

  return { custom_id: id, title, components: components as ModalRenderResult["components"] };
}
