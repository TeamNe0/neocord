import type { HasParams, ParamValue, RouteParamInput } from "@neocord/routing";
import type {
  APIFileUploadComponent,
  APILabelComponent,
  APIMessageTopLevelComponent,
  APITextDisplayComponent,
  AnySelectMenuInteraction,
  AttachmentPayload,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChannelType,
  MentionableSelectMenuInteraction,
  MessageFlags,
  MessageMentionOptions,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  TimestampStylesString,
  UserSelectMenuInteraction,
} from "discord.js";
import type { ReactNode } from "react";

export interface RegisteredRoutes {}

export type ButtonRoute = RegisteredRoutes extends { buttons: infer R extends string } ? R : string;
export type SelectRoute = RegisteredRoutes extends { selects: infer R extends string } ? R : string;
export type ModalRoute = RegisteredRoutes extends { modals: infer R extends string } ? R : string;

export type RouteParamsRecord = Readonly<Record<string, ParamValue | readonly ParamValue[]>>;

type RouteTarget<R extends string> = R extends string
  ? HasParams<R> extends true
    ? { route: R; params: RouteParamInput<R> }
    : { route: R; params?: never }
  : never;

export type RouteAddress<R extends string> = string extends R
  ? { route: string; params?: RouteParamsRecord }
  : RouteTarget<R>;

type Addressed<R extends string, HandlerKey extends string, Handler> =
  | (RouteAddress<R> & { customId?: never } & { [K in HandlerKey]?: never })
  | ({ customId: string; route?: never; params?: never } & { [K in HandlerKey]?: never })
  | ({ route?: never; params?: never; customId?: never } & { [K in HandlerKey]: Handler });

export interface RenderResult {
  flags: MessageFlags.IsComponentsV2 | (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  components: APIMessageTopLevelComponent[];
  files?: AttachmentPayload[];
  allowedMentions?: MessageMentionOptions;
}

export interface ModalRenderResult {
  custom_id: string;
  title: string;
  components: (APILabelComponent | APITextDisplayComponent)[];
}

export interface ModalOptions {
  customId: string;
  title: string;
}

export interface RenderOptions {
  live?: never;
}

export interface LiveRootOptions {
  sessionId: string;
  onUpdate?: (result: RenderResult) => unknown;
  onError?: (error: unknown) => unknown;
}

export interface LiveRoot {
  render(node: ReactNode): void;
  readonly payload: RenderResult;
  readonly hasHandlers: boolean;
  dispatch(customId: string, event: unknown): Promise<boolean>;
  flush(): Promise<void>;
  settle(): Promise<void>;
  disableInteractive(): RenderResult;
  unmount(): void;
}

export type LiveInteraction = ButtonInteraction | AnySelectMenuInteraction;

export type EmojiInput = string | { id?: string; name?: string; animated?: boolean };

export interface BaseComponentProps {
  id?: number;
}

export interface LayoutProps extends BaseComponentProps {
  children?: ReactNode;
}

export interface MessageProps {
  ephemeral?: boolean;
  allowedMentions?: MessageMentionOptions;
  children?: ReactNode;
}

export type NamedColor = "blurple" | "green" | "yellow" | "fuchsia" | "red" | "white" | "black";
export type AccentColor = number | `#${string}` | NamedColor;

export interface ContainerProps extends LayoutProps {
  accentColor?: AccentColor;
  spoiler?: boolean;
}

export interface SectionProps extends LayoutProps {
  accessory: ReactNode;
}

export type TextDisplayProps = LayoutProps;
export type ActionRowProps = LayoutProps;

export interface SeparatorProps extends BaseComponentProps {
  divider?: boolean;
  spacing?: "small" | "large";
  children?: never;
}

export type MediaSource =
  | { src: string; name?: string }
  | { src: Buffer | Uint8Array; name: string };

export type MediaItemProps = MediaSource & {
  description?: string;
  spoiler?: boolean;
  children?: never;
};

export type ThumbnailProps = BaseComponentProps & MediaItemProps;

export type MediaGalleryProps = BaseComponentProps &
  (
    | { items: readonly MediaItemProps[]; children?: never }
    | { items?: never; children: ReactNode }
  );

export type FileProps = BaseComponentProps &
  MediaSource & {
    spoiler?: boolean;
    children?: never;
  };

export type InteractiveButtonStyle = "primary" | "secondary" | "success" | "danger";

type ButtonContent =
  | { label: string; children?: never; emoji?: EmojiInput }
  | { label?: never; children: ReactNode; emoji?: EmojiInput }
  | { label?: never; children?: never; emoji: EmojiInput };

interface ButtonBase extends BaseComponentProps {
  disabled?: boolean;
}

export type ButtonClickHandler = (event: ButtonInteraction) => unknown;

export type InteractiveButtonProps<R extends string = ButtonRoute> = ButtonBase & {
  style?: InteractiveButtonStyle;
  url?: never;
  skuId?: never;
} & ButtonContent &
  Addressed<R, "onClick", ButtonClickHandler>;

export type LinkButtonProps = ButtonBase & {
  style: "link";
  url: string;
  skuId?: never;
  route?: never;
  params?: never;
  customId?: never;
  onClick?: never;
} & ButtonContent;

export type PremiumButtonProps = ButtonBase & {
  style: "premium";
  skuId: string;
  url?: never;
  label?: never;
  children?: never;
  emoji?: never;
  route?: never;
  params?: never;
  customId?: never;
  onClick?: never;
};

export type ButtonProps<R extends string = ButtonRoute> =
  | InteractiveButtonProps<R>
  | LinkButtonProps
  | PremiumButtonProps;

export interface OptionProps {
  label: string;
  value: string;
  description?: string;
  emoji?: EmojiInput;
  default?: boolean;
  children?: never;
}

export type ModalOptionProps = Omit<OptionProps, "emoji" | "children">;

interface SelectBase extends BaseComponentProps {
  placeholder?: string;
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
  required?: boolean;
}

export type SelectHandler<E> = (event: E) => unknown;

type SelectAddress<R extends string, E> = Addressed<R, "onSelect", SelectHandler<E>>;

export type StringSelectProps<R extends string = SelectRoute> = SelectBase &
  SelectAddress<R, StringSelectMenuInteraction> &
  (
    | { options: readonly Omit<OptionProps, "children">[]; children?: never }
    | { options?: never; children: ReactNode }
  );

export type SelectDefaultValue<T extends string> = string | { id: string; type: T };

export type UserSelectProps<R extends string = SelectRoute> = SelectBase &
  SelectAddress<R, UserSelectMenuInteraction> & {
    defaultValues?: readonly SelectDefaultValue<"user">[];
    children?: never;
  };

export type RoleSelectProps<R extends string = SelectRoute> = SelectBase &
  SelectAddress<R, RoleSelectMenuInteraction> & {
    defaultValues?: readonly SelectDefaultValue<"role">[];
    children?: never;
  };

export type MentionableSelectProps<R extends string = SelectRoute> = SelectBase &
  SelectAddress<R, MentionableSelectMenuInteraction> & {
    defaultValues?: readonly { id: string; type: "user" | "role" }[];
    children?: never;
  };

export type ChannelSelectProps<R extends string = SelectRoute> = SelectBase &
  SelectAddress<R, ChannelSelectMenuInteraction> & {
    defaultValues?: readonly SelectDefaultValue<"channel">[];
    channelTypes?: readonly ChannelType[];
    children?: never;
  };

export type ModalProps<R extends string = ModalRoute> = {
  title: string;
  children?: ReactNode;
} & (
  | (RouteAddress<R> & { customId?: never })
  | { customId: string; route?: never; params?: never }
);

export interface LabelProps extends LayoutProps {
  label: string;
  description?: string;
}

export type TextInputProps = BaseComponentProps & {
  customId: string;
  style?: "short" | "paragraph";
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
} & ({ value?: string; children?: never } | { value?: never; children: ReactNode });

export interface FileUploadProps extends BaseComponentProps {
  customId: string;
  minValues?: number;
  maxValues?: number;
  fileTypes?: NonNullable<APIFileUploadComponent["file_types"]>;
  required?: boolean;
  children?: never;
}

export type RadioGroupProps = BaseComponentProps & {
  customId: string;
  required?: boolean;
} & (
    | { options: readonly ModalOptionProps[]; children?: never }
    | { options?: never; children: ReactNode }
  );

export type CheckboxGroupProps = BaseComponentProps & {
  customId: string;
  minValues?: number;
  maxValues?: number;
  required?: boolean;
} & (
    | { options: readonly ModalOptionProps[]; children?: never }
    | { options?: never; children: ReactNode }
  );

export interface CheckboxProps extends BaseComponentProps {
  customId: string;
  default?: boolean;
  children?: never;
}

export interface InlineProps {
  children?: ReactNode;
}

export type BoldProps = InlineProps;
export type ItalicProps = InlineProps;
export type UnderlineProps = InlineProps;
export type StrikethroughProps = InlineProps;
export type SpoilerProps = InlineProps;
export type CodeProps = InlineProps;
export type QuoteProps = InlineProps;
export type SubtextProps = InlineProps;
export type ListItemProps = InlineProps;

export interface CodeBlockProps extends InlineProps {
  language?: string;
}

export interface HeadingProps extends InlineProps {
  level?: 1 | 2 | 3;
}

export interface LinkProps extends InlineProps {
  href: string;
}

export interface ListProps {
  ordered?: boolean;
  children?: ReactNode;
}

export interface MentionProps {
  id: string;
  children?: never;
}

export type UserMentionProps = MentionProps;
export type RoleMentionProps = MentionProps;
export type ChannelMentionProps = MentionProps;

export interface TimestampProps {
  date: Date | number | string;
  style?: TimestampStylesString;
  children?: never;
}

export type EmojiProps =
  | { emoji: EmojiInput; name?: never; id?: never; animated?: never; children?: never }
  | { name: string; id?: string; animated?: boolean; emoji?: never; children?: never };

export interface LineBreakProps {
  children?: never;
}
