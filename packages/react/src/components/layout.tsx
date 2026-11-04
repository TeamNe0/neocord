import type { ReactElement } from "react";
import { HOST, hostElement } from "../host.ts";
import type {
  ActionRowProps,
  ContainerProps,
  FileProps,
  MediaGalleryProps,
  MediaItemProps,
  MessageProps,
  SectionProps,
  SeparatorProps,
  TextDisplayProps,
  ThumbnailProps,
} from "../types.ts";

export function Message(props: MessageProps): ReactElement {
  return hostElement(HOST.message, props);
}

export function Container(props: ContainerProps): ReactElement {
  return hostElement(HOST.container, props);
}

export function Section({ accessory, children, ...props }: SectionProps): ReactElement {
  return hostElement(HOST.section, props, children, hostElement(HOST.accessory, null, accessory));
}

export function TextDisplay(props: TextDisplayProps): ReactElement {
  return hostElement(HOST.textDisplay, props);
}

export function Separator(props: SeparatorProps): ReactElement {
  return hostElement(HOST.separator, props);
}

export function ActionRow(props: ActionRowProps): ReactElement {
  return hostElement(HOST.actionRow, props);
}

export function MediaGallery(props: MediaGalleryProps): ReactElement {
  return hostElement(HOST.mediaGallery, props);
}

export function MediaItem(props: MediaItemProps): ReactElement {
  return hostElement(HOST.mediaItem, props);
}

export function Thumbnail(props: ThumbnailProps): ReactElement {
  return hostElement(HOST.thumbnail, props);
}

export function File(props: FileProps): ReactElement {
  return hostElement(HOST.file, props);
}
