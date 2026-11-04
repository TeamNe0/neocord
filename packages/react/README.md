# @neocord/react

Compose Discord messages and modals with React. `@neocord/react` is a real renderer built on `react-reconciler`, so function components, context, hooks and `<Suspense>` all work. The committed tree is serialised to Discord's Components V2 JSON and validated against Discord's limits, with errors that name the offending component.

```sh
bun add @neocord/react react discord.js
```

Requires React 19.3 or later, discord.js 14.28 or later, and Node 22.12 or later or Bun.

## Rendering a message

```tsx
import { ActionRow, Bold, Button, Container, Heading, Message, render } from "@neocord/react";

function Welcome({ name }: { name: string }) {
  return (
    <Container accentColor="blurple">
      <Heading level={2}>Welcome</Heading>
      Hello <Bold>{name}</Bold>, glad you are here.
      <ActionRow>
        <Button style="primary" customId="welcome/start" label="Get started" />
        <Button style="link" url="https://example.com/docs" label="Docs" />
      </ActionRow>
    </Container>
  );
}

await interaction.reply(
  render(
    <Message ephemeral allowedMentions={{ parse: [] }}>
      <Welcome name="Ada" />
    </Message>,
  ),
);
```

`render` returns a `RenderResult`:

```ts
interface RenderResult {
  flags: MessageFlags.IsComponentsV2 | (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  components: APIMessageTopLevelComponent[];
  files?: AttachmentPayload[];
  allowedMentions?: MessageMentionOptions;
}
```

`flags` covers the ephemeral case, and discord.js only accepts `Ephemeral` on `interaction.reply`. For `editReply`, `update`, `send` and `edit`, replace the flags first:

```ts
function forEdit({ flags, ...rest }: RenderResult) {
  return { ...rest, flags: MessageFlags.IsComponentsV2 as const };
}

await interaction.editReply(forEdit(render(node)));
```

### Sync and async rendering

| Function | Behaviour |
| --- | --- |
| `render(node)` | Synchronous. Throws if anything suspends. |
| `renderAsync(node)` | Waits for `<Suspense>` and `use()` to resolve, then serialises. |
| `renderModal(node, options)` | Synchronous modal rendering. Throws if anything suspends. |

```tsx
function Profile({ user }: { user: Promise<User> }) {
  return <TextDisplay>{use(user).name}</TextDisplay>;
}

const result = await renderAsync(<Profile user={fetchUser(id)} />);
```

Errors thrown while rendering are rethrown to the caller unchanged, unless an error boundary in your tree catches them. React logs nothing to the console.

## Text

Text can sit directly in `Message`, `Container`, `Section`, `Modal` or at the root. Adjacent strings, numbers and inline elements collapse into one `TextDisplay`, and whitespace between block elements produces nothing. Plain strings are not escaped, so use `escapeMarkdown` on user input.

```tsx
<Container>
  You have <Bold>{count}</Bold> messages.
  <Separator />
  <TextDisplay>Explicit text display</TextDisplay>
</Container>
```

Inline components serialise to Discord markdown and nest freely. A function component that returns them works anywhere text does.

| Component | Output |
| --- | --- |
| `<Bold>`, `<Italic>`, `<Underline>`, `<Strikethrough>`, `<Spoiler>` | `**x**`, `*x*`, `__x__`, `~~x~~`, <code>&#124;&#124;x&#124;&#124;</code> |
| `<Code>` | `` `x` `` |
| `<CodeBlock language="ts">` | a fenced code block |
| `<Quote>` | `> ` on every line |
| `<Heading level={1 \| 2 \| 3}>` | `#`, `##` or `###` |
| `<Subtext>` | `-# ` on every line |
| `<Link href="https://...">` | `[text](url)` |
| `<List ordered>` and `<ListItem>` | `- item` or `1. item`, nesting allowed |
| `<UserMention id>`, `<RoleMention id>`, `<ChannelMention id>` | `<@id>`, `<@&id>`, `<#id>` |
| `<Timestamp date style="R">` | `<t:seconds:R>`. `date` is a `Date`, milliseconds or a date string. |
| `<Emoji name="😀" />`, `<Emoji name="party" id="123" animated />`, `<Emoji emoji="<:party:123>" />` | the emoji |
| `<LineBreak />` | a newline |

`CodeBlock`, `Quote`, `Heading`, `Subtext` and `List` always start on their own line.

## Layout

```tsx
<Section accessory={<Thumbnail src="https://example.com/a.png" description="Avatar" />}>
  Up to three text blocks beside an accessory, which is a Button or a Thumbnail.
</Section>

<Separator divider={false} spacing="large" />

<MediaGallery>
  <MediaItem src="https://example.com/a.png" description="A" />
  <MediaItem src={buffer} name="b.png" spoiler />
</MediaGallery>

<File src={buffer} name="report.txt" />
```

`Container` takes `accentColor` as a number, `#rrggbb`, or one of `blurple`, `green`, `yellow`, `fuchsia`, `red`, `white` and `black`, plus `spoiler`.

`src` on `Thumbnail`, `MediaItem` and `File` accepts a URL, an `attachment://` reference, a `Buffer` or a `Uint8Array`. Binary sources need a `name`, which the types enforce. They are collected into `files` and referenced as `attachment://name`. Discord only allows `attachment://` on `File`, so a plain URL there throws.

## Buttons and selects

Address a handler in one of three ways, which the types keep mutually exclusive:

```tsx
<Button style="danger" route="moderation/confirm-ban/[userId]" params={{ userId }} label="Ban" />
<Button customId="raw-custom-id" label="Escape hatch" />
<Button onClick={() => setCount(count + 1)}>Live, count: {count}</Button>
```

- `style` is `primary`, `secondary` (default), `success` or `danger`. `style="link"` takes `url`, and `style="premium"` takes `skuId` and no label.
- Use either `label` or `children`. `emoji` is a string, `<:name:id>`, `<a:name:id>` or `{ id, name, animated }`.
- Custom ids starting with `~` are reserved for live sessions.

Selects use the same addressing, with `onSelect` instead of `onClick`:

```tsx
<ActionRow>
  <StringSelect route="settings/theme" placeholder="Theme" minValues={1} maxValues={1}>
    <Option label="Dark" value="dark" emoji="🌙" default />
    <Option label="Light" value="light" description="Bright" />
  </StringSelect>
</ActionRow>

<ActionRow>
  <ChannelSelect customId="pick-channel" channelTypes={[ChannelType.GuildText]} defaultValues={[channelId]} />
</ActionRow>
```

`StringSelect` also accepts an `options` array. `UserSelect`, `RoleSelect` and `ChannelSelect` take `defaultValues` as ids or `{ id, type }`, and `MentionableSelect` takes `{ id, type }` objects. An `ActionRow` holds up to five buttons or one select.

## Modals

```tsx
import { Label, Modal, renderModal, TextInput } from "@neocord/react";

await interaction.showModal(
  renderModal(
    <Modal route="moderation/ban-reason/[userId]" params={{ userId }} title="Ban reason">
      Tell us what happened.
      <Label label="Reason" description="Shown in the audit log">
        <TextInput customId="reason" style="paragraph" maxLength={500} placeholder="Spam" />
      </Label>
    </Modal>,
  ),
);
```

`renderModal(node, { customId, title })` works without the `Modal` wrapper. A modal holds one to five `Label` or `TextDisplay` children, and each `Label` wraps one of `TextInput`, a select, `FileUpload`, `RadioGroup`, `CheckboxGroup` or `Checkbox`. `RadioGroup` and `CheckboxGroup` take `Option` children or an `options` array.

## Typed routes

`route` and `params` are checked against the `RegisteredRoutes` interface, which the neocord CLI generates:

```ts
declare module "@neocord/react" {
  interface RegisteredRoutes {
    buttons: "moderation/confirm-ban/[userId]" | "settings/open";
    selects: "settings/theme";
    modals: "moderation/ban-reason/[userId]";
  }
}
```

`params` is then required exactly when a route has params, and forbidden otherwise. With nothing registered, `route` is a `string` and `params` is an optional record. `buildCustomId` and the `RouteParams` type are re-exported from `@neocord/routing`.

## Live sessions

`onClick` and `onSelect` need a live root, because a handler can only run while its tree is mounted. One-shot `render` throws if it meets one.

```tsx
import { ActionRow, Button, createLiveRoot, TextDisplay, useLiveInteraction } from "@neocord/react";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <>
      <TextDisplay>Count: {count}</TextDisplay>
      <ActionRow>
        <Button style="primary" label="Add" onClick={() => setCount(count + 1)} />
      </ActionRow>
    </>
  );
}

const root = createLiveRoot({
  sessionId: interaction.id,
  onUpdate: (result) => interaction.editReply(forEdit(result)),
  onError: (error) => logger.error(error),
});

root.render(<Counter />);
await interaction.reply(root.payload);

client.on("interactionCreate", async (event) => {
  if (!event.isMessageComponent()) return;
  if (await root.dispatch(event.customId, event)) {
    await event.update(forEdit(root.payload));
  }
});
```

| Member | Behaviour |
| --- | --- |
| `render(node)` | Commits synchronously. Component and validation errors throw here. |
| `payload` | The latest `RenderResult`. |
| `hasHandlers` | Whether the committed tree has any `onClick` or `onSelect`. |
| `dispatch(customId, event)` | Runs the handler in a batch and flushes. It waits for async handlers and resolves to `false` for unknown ids. |
| `flush()` | Applies pending updates and effects. |
| `disableInteractive()` | Returns the payload with every button and select disabled. The tree is not changed. |
| `unmount()` | Unmounts the tree and runs effect cleanups. Later dispatches return `false`. `payload` keeps its last value. |

Custom ids look like `~<sessionId>:<n>`. They follow React's identity rules, so a component keeps its id across re-renders for as long as its position and key stay the same. An old message's button dispatches to the newest closure.

`onUpdate` fires for commits outside `dispatch` and `render`, such as a timer calling `setState` or a suspended component resolving. After a dispatch, read `payload` yourself.

Errors from background commits and from `onUpdate` go to `onError`. Without `onError`, they are rethrown by the next `flush` or `dispatch`. After an uncaught component error, the tree is gone: `payload` keeps the last good value, dispatches return `false`, and calling `render` starts over.

`useLiveInteraction()` returns the current event for components that render during a dispatch, and `null` otherwise. Handlers also receive the event as their argument.

```tsx
const interaction = useLiveInteraction();
return <TextDisplay>Last clicked by {interaction?.user.username ?? "nobody"}</TextDisplay>;
```

## Limits

Everything below throws at render time, and the message names the component.

- 40 total components in a message, with unique `id` and `customId` values.
- `TextDisplay` 1-4000 characters, `Container` 1-40 children.
- `ActionRow` up to five buttons or one select. `Section` 1-3 text blocks and exactly one accessory.
- `Button` label up to 80 characters, url up to 512, and a label or emoji is required.
- Selects: placeholder up to 150, 1-25 options with unique values, `minValues` and `maxValues` within 0-25, and default values that fit the range.
- `MediaGallery` 1-10 items, descriptions up to 1024, and `File` must use `attachment://`.
- `Modal` title up to 45 characters and 1-5 children. `Label` text up to 45 and description up to 100. `TextInput` lengths up to 4000.
- `FileUpload` up to 10 files, `RadioGroup` 2-10 options with one default, and `CheckboxGroup` 1-10 options.

## License

MIT
