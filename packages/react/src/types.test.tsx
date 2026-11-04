import { describe, expect, expectTypeOf, test } from "bun:test";
import type {
  APILabelComponent,
  APIMessageTopLevelComponent,
  APIModalInteractionResponseCallbackData,
  APITextDisplayComponent,
  AttachmentPayload,
  ButtonInteraction,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessageCreateOptions,
  MessageEditOptions,
  MessageFlags,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import type { ReactElement, ReactNode } from "react";
import {
  Button,
  buildCustomId,
  createLiveRoot,
  Emoji,
  escapeMarkdown,
  File,
  render,
  renderAsync,
  renderModal,
  useLiveInteraction,
  type AccentColor,
  type ButtonProps,
  type ChannelSelectProps,
  type CheckboxGroupProps,
  type CheckboxProps,
  type ContainerProps,
  type EmojiInput,
  type EmojiProps,
  type FileProps,
  type FileUploadProps,
  type HeadingProps,
  type LiveRoot,
  type MediaGalleryProps,
  type MediaItemProps,
  type MentionableSelectProps,
  type MessageProps,
  type ModalProps,
  type ModalRenderResult,
  type OptionProps,
  type RadioGroupProps,
  type RegisteredRoutes,
  type RenderResult,
  type RoleSelectProps,
  type RouteParams,
  type SectionProps,
  type SeparatorProps,
  type StringSelectProps,
  type TextInputProps,
  type ThumbnailProps,
  type TimestampProps,
  type UserSelectProps,
} from "./index.ts";

type Extends<A, B> = [A] extends [B] ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function assertType<_T extends true>(): void {}

function assertFalse<_T extends false>(): void {}

type Routes = "mod/confirm/[userId]" | "mod/ping" | "mod/all/[...rest]";
type Routed = ButtonProps<Routes>;

describe("Button addressing types", () => {
  test("route, customId and onClick are mutually exclusive", () => {
    assertType<Extends<{ route: "a"; label: "x" }, ButtonProps>>();
    assertType<Extends<{ customId: "a"; label: "x" }, ButtonProps>>();
    assertType<Extends<{ onClick: () => void; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ route: "a"; customId: "b"; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ route: "a"; onClick: () => void; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ customId: "b"; onClick: () => void; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ label: "x" }, ButtonProps>>();
    expect(true).toBe(true);
  });

  test("params are required exactly when a registered route has params", () => {
    assertType<Extends<{ route: "mod/ping"; label: "x" }, Routed>>();
    assertType<Extends<{ route: "mod/confirm/[userId]"; params: { userId: string }; label: "x" }, Routed>>();
    assertType<Extends<{ route: "mod/confirm/[userId]"; params: { userId: 12n }; label: "x" }, Routed>>();
    assertType<Extends<{ route: "mod/all/[...rest]"; params: { rest: readonly string[] }; label: "x" }, Routed>>();
    assertFalse<Extends<{ route: "mod/confirm/[userId]"; label: "x" }, Routed>>();
    assertFalse<Extends<{ route: "mod/confirm/[userId]"; params: { other: string }; label: "x" }, Routed>>();
    assertFalse<Extends<{ route: "mod/ping"; params: { userId: string }; label: "x" }, Routed>>();
    assertFalse<Extends<{ route: "mod/unknown"; label: "x" }, Routed>>();
    assertFalse<Extends<{ route: "mod/all/[...rest]"; params: { rest: string }; label: "x" }, Routed>>();
    expect(true).toBe(true);
  });

  test("an empty route map falls back to string and optional params", () => {
    assertType<Equal<keyof RegisteredRoutes, never>>();
    assertType<Extends<{ route: string; label: "x" }, ButtonProps>>();
    assertType<Extends<{ route: "x/[id]"; params: { id: string; rest: string[] }; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ route: "x"; params: { id: boolean }; label: "x" }, ButtonProps>>();
    expect(true).toBe(true);
  });

  test("a registered route map with no entries disables route addressing", () => {
    assertFalse<Extends<{ route: "x"; label: "x" }, ButtonProps<never>>>();
    assertType<Extends<{ customId: "x"; label: "x" }, ButtonProps<never>>>();
    expect(true).toBe(true);
  });

  test("onClick receives a button interaction", () => {
    type Handler = Extract<ButtonProps, { onClick: unknown }>["onClick"];
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<ButtonInteraction>();
    expect(true).toBe(true);
  });
});

describe("Button shape types", () => {
  test("styles", () => {
    assertType<Extends<{ style: "primary"; customId: "a"; label: "x" }, ButtonProps>>();
    assertType<Extends<{ style: "danger"; customId: "a"; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "pink"; customId: "a"; label: "x" }, ButtonProps>>();
    expect(true).toBe(true);
  });

  test("link requires url and forbids addressing", () => {
    assertType<Extends<{ style: "link"; url: "https://x"; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "link"; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "link"; url: "https://x"; customId: "a"; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "link"; url: "https://x"; onClick: () => void; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "primary"; url: "https://x"; customId: "a"; label: "x" }, ButtonProps>>();
    expect(true).toBe(true);
  });

  test("premium requires skuId and forbids content", () => {
    assertType<Extends<{ style: "premium"; skuId: "1" }, ButtonProps>>();
    assertFalse<Extends<{ style: "premium" }, ButtonProps>>();
    assertFalse<Extends<{ style: "premium"; skuId: "1"; label: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "premium"; skuId: "1"; children: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "premium"; skuId: "1"; emoji: "x" }, ButtonProps>>();
    assertFalse<Extends<{ style: "premium"; skuId: "1"; customId: "x" }, ButtonProps>>();
    expect(true).toBe(true);
  });

  test("label xor children, with emoji alone allowed", () => {
    assertType<Extends<{ customId: "a"; children: "x" }, ButtonProps>>();
    assertType<Extends<{ customId: "a"; emoji: "x" }, ButtonProps>>();
    assertType<Extends<{ customId: "a"; emoji: { id: "1"; name: "n"; animated: true } }, ButtonProps>>();
    assertFalse<Extends<{ customId: "a"; label: "x"; children: "y" }, ButtonProps>>();
    assertFalse<Extends<{ customId: "a" }, ButtonProps>>();
    expect(true).toBe(true);
  });
});

describe("select types", () => {
  type RoutedSelect = StringSelectProps<"f/pick/[id]" | "f/one">;

  test("addressing mirrors buttons with onSelect", () => {
    const options = [{ label: "a", value: "a" }] as const;
    type Options = typeof options;
    assertType<Extends<{ route: "a"; options: Options }, StringSelectProps>>();
    assertType<Extends<{ customId: "a"; options: Options }, StringSelectProps>>();
    assertType<Extends<{ onSelect: () => void; options: Options }, StringSelectProps>>();
    assertFalse<Extends<{ onClick: () => void; options: Options }, StringSelectProps>>();
    assertFalse<Extends<{ route: "a"; customId: "b"; options: Options }, StringSelectProps>>();
    assertFalse<Extends<{ options: Options }, StringSelectProps>>();
    assertType<Extends<{ route: "f/one"; options: Options }, RoutedSelect>>();
    assertType<Extends<{ route: "f/pick/[id]"; params: { id: 1 }; options: Options }, RoutedSelect>>();
    assertFalse<Extends<{ route: "f/pick/[id]"; options: Options }, RoutedSelect>>();
    assertFalse<Extends<{ route: "f/one"; params: { id: 1 }; options: Options }, RoutedSelect>>();
    expect(true).toBe(true);
  });

  test("StringSelect takes options or children", () => {
    assertType<Extends<{ customId: "a"; children: ReactNode }, StringSelectProps>>();
    assertFalse<Extends<{ customId: "a" }, StringSelectProps>>();
    assertFalse<
      Extends<{ customId: "a"; options: { label: "a"; value: "a" }[]; children: "x" }, StringSelectProps>
    >();
    expect(true).toBe(true);
  });

  test("auto-populated selects", () => {
    assertType<Extends<{ customId: "a"; defaultValues: ["1"] }, UserSelectProps>>();
    assertType<Extends<{ customId: "a"; defaultValues: [{ id: "1"; type: "user" }] }, UserSelectProps>>();
    assertFalse<Extends<{ customId: "a"; defaultValues: [{ id: "1"; type: "role" }] }, UserSelectProps>>();
    assertType<Extends<{ customId: "a"; defaultValues: [{ id: "1"; type: "role" }] }, RoleSelectProps>>();
    assertType<Extends<{ customId: "a"; defaultValues: [{ id: "1"; type: "role" }] }, MentionableSelectProps>>();
    assertFalse<Extends<{ customId: "a"; defaultValues: ["1"] }, MentionableSelectProps>>();
    assertType<Extends<{ customId: "a"; channelTypes: [0] }, ChannelSelectProps>>();
    expect(true).toBe(true);
  });

  test("onSelect events are typed per select", () => {
    type StringHandler = Extract<StringSelectProps, { onSelect: unknown }>["onSelect"];
    type UserHandler = Extract<UserSelectProps, { onSelect: unknown }>["onSelect"];
    expectTypeOf<Parameters<StringHandler>[0]>().toEqualTypeOf<StringSelectMenuInteraction>();
    expectTypeOf<Parameters<UserHandler>[0]>().toEqualTypeOf<UserSelectMenuInteraction>();
    expect(true).toBe(true);
  });
});

describe("layout types", () => {
  test("Container accent colors", () => {
    assertType<Extends<0x5865f2, AccentColor>>();
    assertType<Extends<"#5865f2", AccentColor>>();
    assertType<Extends<"blurple", AccentColor>>();
    assertFalse<Extends<"mauve", AccentColor>>();
    assertType<Extends<{ accentColor: "red"; spoiler: true }, ContainerProps>>();
    expect(true).toBe(true);
  });

  test("Separator", () => {
    assertType<Extends<{ spacing: "large"; divider: false }, SeparatorProps>>();
    assertFalse<Extends<{ spacing: "huge" }, SeparatorProps>>();
    assertFalse<Extends<{ children: "x" }, SeparatorProps>>();
    expect(true).toBe(true);
  });

  test("Section requires an accessory", () => {
    assertType<Extends<{ accessory: ReactNode; children: "x" }, SectionProps>>();
    assertFalse<Extends<{ children: "x" }, SectionProps>>();
    expect(true).toBe(true);
  });

  test("buffers require a name", () => {
    assertType<Extends<{ src: "https://x" }, ThumbnailProps>>();
    assertType<Extends<{ src: Buffer; name: "a.png" }, ThumbnailProps>>();
    assertType<Extends<{ src: Uint8Array; name: "a.png" }, MediaItemProps>>();
    assertType<Extends<{ src: Buffer; name: "a.png"; spoiler: true }, FileProps>>();
    assertFalse<Extends<{ src: Buffer }, ThumbnailProps>>();
    assertFalse<Extends<{ src: Buffer }, MediaItemProps>>();
    assertFalse<Extends<{ src: Uint8Array }, FileProps>>();
    assertFalse<Extends<{ src: 5 }, FileProps>>();
    expect(true).toBe(true);
  });

  test("MediaGallery takes items or children", () => {
    assertType<Extends<{ items: [{ src: "x" }] }, MediaGalleryProps>>();
    assertType<Extends<{ children: "x" }, MediaGalleryProps>>();
    assertFalse<Extends<{ items: [{ src: "x" }]; children: "x" }, MediaGalleryProps>>();
    assertFalse<Extends<{ items: [{ src: Buffer }] }, MediaGalleryProps>>();
    expect(true).toBe(true);
  });

  test("Message", () => {
    assertType<Extends<{ ephemeral: true; allowedMentions: { parse: [] } }, MessageProps>>();
    expect(true).toBe(true);
  });
});

describe("modal types", () => {
  type RoutedModal = ModalProps<"f/ban/[id]" | "f/hello">;

  test("Modal addressing", () => {
    assertType<Extends<{ title: "t"; customId: "c" }, ModalProps>>();
    assertType<Extends<{ title: "t"; route: "c" }, ModalProps>>();
    assertFalse<Extends<{ title: "t" }, ModalProps>>();
    assertFalse<Extends<{ customId: "c" }, ModalProps>>();
    assertFalse<Extends<{ title: "t"; customId: "c"; route: "c" }, ModalProps>>();
    assertType<Extends<{ title: "t"; route: "f/hello" }, RoutedModal>>();
    assertType<Extends<{ title: "t"; route: "f/ban/[id]"; params: { id: 1 } }, RoutedModal>>();
    assertFalse<Extends<{ title: "t"; route: "f/ban/[id]" }, RoutedModal>>();
    expect(true).toBe(true);
  });

  test("TextInput", () => {
    assertType<Extends<{ customId: "a"; style: "paragraph"; value: "v" }, TextInputProps>>();
    assertType<Extends<{ customId: "a"; children: "v" }, TextInputProps>>();
    assertFalse<Extends<{ customId: "a"; value: "v"; children: "v" }, TextInputProps>>();
    assertFalse<Extends<{ value: "v" }, TextInputProps>>();
    assertFalse<Extends<{ customId: "a"; style: "long" }, TextInputProps>>();
    expect(true).toBe(true);
  });

  test("groups and uploads", () => {
    assertType<Extends<{ customId: "a"; children: "x" }, RadioGroupProps>>();
    assertType<Extends<{ customId: "a"; options: { label: "a"; value: "a" }[] }, RadioGroupProps>>();
    assertFalse<Extends<{ customId: "a"; options: { label: "a"; value: "a"; emoji: "x" }[]; children: "y" }, RadioGroupProps>>();
    assertType<Extends<{ customId: "a"; maxValues: 2; children: "x" }, CheckboxGroupProps>>();
    assertType<Extends<{ customId: "a"; default: true }, CheckboxProps>>();
    assertType<Extends<{ customId: "a"; fileTypes: ["image"] }, FileUploadProps>>();
    assertType<Extends<{ label: "a"; value: "b"; emoji: "x"; default: true }, OptionProps>>();
    expect(true).toBe(true);
  });
});

describe("inline types", () => {
  test("Heading, Timestamp and Emoji", () => {
    assertType<Extends<{ level: 2 }, HeadingProps>>();
    assertFalse<Extends<{ level: 4 }, HeadingProps>>();
    assertType<Extends<{ date: Date; style: "R" }, TimestampProps>>();
    assertFalse<Extends<{ date: Date; style: "x" }, TimestampProps>>();
    assertType<Extends<{ emoji: "x" }, EmojiProps>>();
    assertType<Extends<{ name: "x"; id: "1"; animated: true }, EmojiProps>>();
    assertFalse<Extends<{ id: "1" }, EmojiProps>>();
    assertType<Extends<{ id: "1"; name: "x" }, EmojiInput>>();
    expect(true).toBe(true);
  });
});

describe("public function types", () => {
  test("result types match the contract and discord.js", () => {
    expectTypeOf<RenderResult["components"]>().toEqualTypeOf<APIMessageTopLevelComponent[]>();
    expectTypeOf<RenderResult["files"]>().toEqualTypeOf<AttachmentPayload[] | undefined>();
    expectTypeOf<ModalRenderResult["components"]>().toEqualTypeOf<(APILabelComponent | APITextDisplayComponent)[]>();
    type NonEphemeral = Omit<RenderResult, "flags"> & { flags: MessageFlags.IsComponentsV2 };
    assertType<Extends<RenderResult, InteractionReplyOptions>>();
    assertType<Extends<NonEphemeral, InteractionUpdateOptions>>();
    assertType<Extends<NonEphemeral, MessageCreateOptions>>();
    assertType<Extends<NonEphemeral, MessageEditOptions>>();
    assertType<Extends<ModalRenderResult, APIModalInteractionResponseCallbackData>>();
    expect(true).toBe(true);
  });

  test("render signatures", () => {
    expectTypeOf(render).returns.toEqualTypeOf<RenderResult>();
    expectTypeOf(renderAsync).returns.toEqualTypeOf<Promise<RenderResult>>();
    expectTypeOf(createLiveRoot).returns.toEqualTypeOf<LiveRoot>();
    expectTypeOf<LiveRoot["dispatch"]>().returns.toEqualTypeOf<Promise<boolean>>();
    expectTypeOf(escapeMarkdown).returns.toEqualTypeOf<string>();
    expectTypeOf(buildCustomId).returns.toEqualTypeOf<string>();
    expectTypeOf<RouteParams<"a/[b]">>().toEqualTypeOf<{ b: string }>();
    expectTypeOf(useLiveInteraction<{ a: 1 }>).returns.toEqualTypeOf<{ a: 1 } | null>();
    expect(true).toBe(true);
  });

  test("renderModal overloads make options optional only for elements", () => {
    assertType<Extends<[ReactElement], Parameters<typeof renderModalElement>>>();
    assertFalse<Extends<[ReactNode], Parameters<typeof renderModalElement>>>();
    assertType<Extends<[ReactNode, { customId: string; title: string }], Parameters<typeof renderModal>>>();
    assertFalse<Extends<[ReactNode, { customId: string }], Parameters<typeof renderModal>>>();
    expect(true).toBe(true);
  });

  test("components accept JSX composition", () => {
    expectTypeOf(Button).returns.toEqualTypeOf<ReactElement>();
    expectTypeOf(File).returns.toEqualTypeOf<ReactElement>();
    expectTypeOf(Emoji).returns.toEqualTypeOf<ReactElement>();
    expect(true).toBe(true);
  });
});

function renderModalElement(node: ReactElement): ModalRenderResult {
  return renderModal(node);
}
