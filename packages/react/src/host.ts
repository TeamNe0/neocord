import { createElement, type ReactElement, type ReactNode } from "react";

export const HOST = {
  message: "neocord:message",
  container: "neocord:container",
  section: "neocord:section",
  accessory: "neocord:accessory",
  textDisplay: "neocord:text-display",
  separator: "neocord:separator",
  actionRow: "neocord:action-row",
  mediaGallery: "neocord:media-gallery",
  mediaItem: "neocord:media-item",
  thumbnail: "neocord:thumbnail",
  file: "neocord:file",
  button: "neocord:button",
  stringSelect: "neocord:string-select",
  option: "neocord:option",
  userSelect: "neocord:user-select",
  roleSelect: "neocord:role-select",
  mentionableSelect: "neocord:mentionable-select",
  channelSelect: "neocord:channel-select",
  modal: "neocord:modal",
  label: "neocord:label",
  textInput: "neocord:text-input",
  fileUpload: "neocord:file-upload",
  radioGroup: "neocord:radio-group",
  checkboxGroup: "neocord:checkbox-group",
  checkbox: "neocord:checkbox",
  bold: "neocord:bold",
  italic: "neocord:italic",
  underline: "neocord:underline",
  strikethrough: "neocord:strikethrough",
  spoiler: "neocord:spoiler",
  code: "neocord:code",
  codeBlock: "neocord:code-block",
  quote: "neocord:quote",
  heading: "neocord:heading",
  subtext: "neocord:subtext",
  link: "neocord:link",
  list: "neocord:list",
  listItem: "neocord:list-item",
  userMention: "neocord:user-mention",
  roleMention: "neocord:role-mention",
  channelMention: "neocord:channel-mention",
  timestamp: "neocord:timestamp",
  emoji: "neocord:emoji",
  lineBreak: "neocord:line-break",
} as const;

export type HostType = (typeof HOST)[keyof typeof HOST];

const COMPONENT_NAMES: Readonly<Record<HostType, string>> = {
  [HOST.message]: "Message",
  [HOST.container]: "Container",
  [HOST.section]: "Section",
  [HOST.accessory]: "Section accessory",
  [HOST.textDisplay]: "TextDisplay",
  [HOST.separator]: "Separator",
  [HOST.actionRow]: "ActionRow",
  [HOST.mediaGallery]: "MediaGallery",
  [HOST.mediaItem]: "MediaItem",
  [HOST.thumbnail]: "Thumbnail",
  [HOST.file]: "File",
  [HOST.button]: "Button",
  [HOST.stringSelect]: "StringSelect",
  [HOST.option]: "Option",
  [HOST.userSelect]: "UserSelect",
  [HOST.roleSelect]: "RoleSelect",
  [HOST.mentionableSelect]: "MentionableSelect",
  [HOST.channelSelect]: "ChannelSelect",
  [HOST.modal]: "Modal",
  [HOST.label]: "Label",
  [HOST.textInput]: "TextInput",
  [HOST.fileUpload]: "FileUpload",
  [HOST.radioGroup]: "RadioGroup",
  [HOST.checkboxGroup]: "CheckboxGroup",
  [HOST.checkbox]: "Checkbox",
  [HOST.bold]: "Bold",
  [HOST.italic]: "Italic",
  [HOST.underline]: "Underline",
  [HOST.strikethrough]: "Strikethrough",
  [HOST.spoiler]: "Spoiler",
  [HOST.code]: "Code",
  [HOST.codeBlock]: "CodeBlock",
  [HOST.quote]: "Quote",
  [HOST.heading]: "Heading",
  [HOST.subtext]: "Subtext",
  [HOST.link]: "Link",
  [HOST.list]: "List",
  [HOST.listItem]: "ListItem",
  [HOST.userMention]: "UserMention",
  [HOST.roleMention]: "RoleMention",
  [HOST.channelMention]: "ChannelMention",
  [HOST.timestamp]: "Timestamp",
  [HOST.emoji]: "Emoji",
  [HOST.lineBreak]: "LineBreak",
};

const INLINE_TYPES: ReadonlySet<string> = new Set<string>([
  HOST.bold,
  HOST.italic,
  HOST.underline,
  HOST.strikethrough,
  HOST.spoiler,
  HOST.code,
  HOST.codeBlock,
  HOST.quote,
  HOST.heading,
  HOST.subtext,
  HOST.link,
  HOST.list,
  HOST.listItem,
  HOST.userMention,
  HOST.roleMention,
  HOST.channelMention,
  HOST.timestamp,
  HOST.emoji,
  HOST.lineBreak,
]);

const SLOTTED_TYPES: ReadonlySet<string> = new Set<string>([
  HOST.button,
  HOST.stringSelect,
  HOST.userSelect,
  HOST.roleSelect,
  HOST.mentionableSelect,
  HOST.channelSelect,
]);

export type HostProps = Record<string, unknown>;

export function hostElement(type: HostType, props: object | null, ...children: ReactNode[]): ReactElement {
  return createElement(type, props as HostProps | null, ...children);
}

export interface HostText {
  readonly kind: "text";
  text: string;
  hidden: boolean;
}

export interface HostElement {
  readonly kind: "element";
  readonly type: string;
  props: HostProps;
  children: HostNode[];
  hidden: boolean;
  readonly slot: string | null;
}

export type HostNode = HostText | HostElement;

export interface HostParent {
  children: HostNode[];
}

export interface HostContainer extends HostParent {
  failure: { readonly error: unknown } | null;
  onCommit: (() => void) | null;
  onUncaughtError: ((error: unknown) => void) | null;
  slotTypes: Map<unknown, number> | null;
}

export function createHostContainer(): HostContainer {
  return { children: [], failure: null, onCommit: null, onUncaughtError: null, slotTypes: null };
}

export function displayName(type: string): string {
  return (COMPONENT_NAMES as Readonly<Record<string, string>>)[type] ?? `<${type}>`;
}

export function isInline(node: HostNode): boolean {
  return node.kind === "text" || INLINE_TYPES.has(node.type);
}

export function needsSlot(type: string): boolean {
  return SLOTTED_TYPES.has(type);
}

export function appendNode(parent: HostParent, child: HostNode): void {
  removeNode(parent, child);
  parent.children.push(child);
}

export function insertNodeBefore(parent: HostParent, child: HostNode, before: HostNode): void {
  removeNode(parent, child);
  const index = parent.children.indexOf(before);
  if (index === -1) {
    parent.children.push(child);
  } else {
    parent.children.splice(index, 0, child);
  }
}

export function removeNode(parent: HostParent, child: HostNode): void {
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
}

export function isBlank(node: HostNode): boolean {
  return node.kind === "text" && node.text.trim() === "";
}

export function visibleNodes(nodes: readonly HostNode[]): HostNode[] {
  return nodes.filter((node) => !node.hidden);
}

export function significantNodes(nodes: readonly HostNode[]): HostNode[] {
  return nodes.filter((node) => !node.hidden && !isBlank(node));
}
