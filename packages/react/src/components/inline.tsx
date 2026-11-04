import type { ReactElement } from "react";
import { HOST, hostElement } from "../host.ts";
import type {
  BoldProps,
  ChannelMentionProps,
  CodeBlockProps,
  CodeProps,
  EmojiProps,
  HeadingProps,
  ItalicProps,
  LineBreakProps,
  LinkProps,
  ListItemProps,
  ListProps,
  QuoteProps,
  RoleMentionProps,
  SpoilerProps,
  StrikethroughProps,
  SubtextProps,
  TimestampProps,
  UnderlineProps,
  UserMentionProps,
} from "../types.ts";

export function Bold(props: BoldProps): ReactElement {
  return hostElement(HOST.bold, props);
}

export function Italic(props: ItalicProps): ReactElement {
  return hostElement(HOST.italic, props);
}

export function Underline(props: UnderlineProps): ReactElement {
  return hostElement(HOST.underline, props);
}

export function Strikethrough(props: StrikethroughProps): ReactElement {
  return hostElement(HOST.strikethrough, props);
}

export function Spoiler(props: SpoilerProps): ReactElement {
  return hostElement(HOST.spoiler, props);
}

export function Code(props: CodeProps): ReactElement {
  return hostElement(HOST.code, props);
}

export function CodeBlock(props: CodeBlockProps): ReactElement {
  return hostElement(HOST.codeBlock, props);
}

export function Quote(props: QuoteProps): ReactElement {
  return hostElement(HOST.quote, props);
}

export function Heading(props: HeadingProps): ReactElement {
  return hostElement(HOST.heading, props);
}

export function Subtext(props: SubtextProps): ReactElement {
  return hostElement(HOST.subtext, props);
}

export function Link(props: LinkProps): ReactElement {
  return hostElement(HOST.link, props);
}

export function List(props: ListProps): ReactElement {
  return hostElement(HOST.list, props);
}

export function ListItem(props: ListItemProps): ReactElement {
  return hostElement(HOST.listItem, props);
}

export function UserMention(props: UserMentionProps): ReactElement {
  return hostElement(HOST.userMention, props);
}

export function RoleMention(props: RoleMentionProps): ReactElement {
  return hostElement(HOST.roleMention, props);
}

export function ChannelMention(props: ChannelMentionProps): ReactElement {
  return hostElement(HOST.channelMention, props);
}

export function Timestamp(props: TimestampProps): ReactElement {
  return hostElement(HOST.timestamp, props);
}

export function Emoji(props: EmojiProps): ReactElement {
  return hostElement(HOST.emoji, props);
}

export function LineBreak(props: LineBreakProps): ReactElement {
  return hostElement(HOST.lineBreak, props);
}
