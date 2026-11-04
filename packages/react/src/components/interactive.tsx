import type { ReactElement } from "react";
import { HOST, hostElement } from "../host.ts";
import type {
  ButtonProps,
  ChannelSelectProps,
  MentionableSelectProps,
  OptionProps,
  RoleSelectProps,
  StringSelectProps,
  UserSelectProps,
} from "../types.ts";

export function Button(props: ButtonProps): ReactElement {
  return hostElement(HOST.button, props);
}

export function StringSelect(props: StringSelectProps): ReactElement {
  return hostElement(HOST.stringSelect, props);
}

export function Option(props: OptionProps): ReactElement {
  return hostElement(HOST.option, props);
}

export function UserSelect(props: UserSelectProps): ReactElement {
  return hostElement(HOST.userSelect, props);
}

export function RoleSelect(props: RoleSelectProps): ReactElement {
  return hostElement(HOST.roleSelect, props);
}

export function MentionableSelect(props: MentionableSelectProps): ReactElement {
  return hostElement(HOST.mentionableSelect, props);
}

export function ChannelSelect(props: ChannelSelectProps): ReactElement {
  return hostElement(HOST.channelSelect, props);
}
