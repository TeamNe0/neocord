import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
  TextInputStyle,
} from "discord.js";
import {
  Activity,
  Component,
  createContext,
  Suspense,
  use,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  ActionRow,
  Bold,
  Button,
  buildCustomId,
  ChannelMention,
  ChannelSelect,
  Checkbox,
  CheckboxGroup,
  Code,
  CodeBlock,
  Container,
  Emoji,
  escapeMarkdown,
  File,
  FileUpload,
  Heading,
  Italic,
  Label,
  LineBreak,
  Link,
  List,
  ListItem,
  MediaGallery,
  MediaItem,
  MentionableSelect,
  Message,
  Modal,
  Option,
  Quote,
  RadioGroup,
  render,
  renderAsync,
  renderModal,
  RoleMention,
  RoleSelect,
  Section,
  Separator,
  Spoiler,
  Strikethrough,
  StringSelect,
  Subtext,
  TextDisplay,
  TextInput,
  Thumbnail,
  Timestamp,
  Underline,
  UserMention,
  UserSelect,
} from "./index.ts";

let errorSpy: Mock<typeof console.error>;
let warnSpy: Mock<typeof console.warn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error");
  warnSpy = spyOn(console, "warn");
});

afterEach(() => {
  const errors = errorSpy.mock.calls.length;
  const warnings = warnSpy.mock.calls.length;
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  expect(errors).toBe(0);
  expect(warnings).toBe(0);
});

function components(node: ReactNode): unknown[] {
  return render(node).components;
}

function only(node: ReactNode): unknown {
  return components(node)[0];
}

function content(node: ReactNode): string {
  return (only(<TextDisplay>{node}</TextDisplay>) as { content: string }).content;
}

function inRow(node: ReactNode): unknown {
  return (only(<ActionRow>{node}</ActionRow>) as { components: unknown[] }).components[0];
}

function buttons(count: number): ReactNode[] {
  return Array.from({ length: count }, (_, index) => <Button key={index} customId={`b${index}`} label="x" />);
}

function inModal(node: ReactNode): unknown {
  const result = renderModal(<Label label="Field">{node}</Label>, { customId: "m", title: "T" });
  return (result.components[0] as { component: unknown }).component;
}

function loose(props: object): any {
  return props;
}

const THROWN = new Error("boom");

function Thrower(): ReactNode {
  throw THROWN;
}

describe("root and result shape", () => {
  test("renders a v2 message without optional fields", () => {
    expect(render(<TextDisplay>hello</TextDisplay>)).toEqual({
      flags: MessageFlags.IsComponentsV2,
      components: [{ type: ComponentType.TextDisplay, content: "hello" }],
    });
  });

  test("Message sets ephemeral flags and allowed mentions", () => {
    const result = render(
      <Message ephemeral allowedMentions={{ parse: [], users: ["1"] }}>
        hi
      </Message>,
    );
    expect(result.flags as number).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    expect(result.allowedMentions).toEqual({ parse: [], users: ["1"] });
    expect(result.components).toEqual([{ type: ComponentType.TextDisplay, content: "hi" }]);
  });

  test("Message must be the only root and cannot nest", () => {
    expect(() =>
      render(
        <>
          <Message>a</Message>
          <TextDisplay>b</TextDisplay>
        </>,
      ),
    ).toThrow("Message must be the only element at the root");
    expect(() =>
      render(
        <Container>
          <Message>a</Message>
        </Container>,
      ),
    ).toThrow("Message must be the root");
  });

  test("Modal is rejected by render", () => {
    expect(() =>
      render(
        <Modal title="t" customId="c">
          text
        </Modal>,
      ),
    ).toThrow("Modal must be rendered with renderModal");
  });

  test("empty messages are rejected", () => {
    expect(() => render(null)).toThrow("Message must contain at least one component");
    expect(() => render(<Message>{"  "}</Message>)).toThrow("Message must contain at least one component");
  });

  test("the live option is rejected", () => {
    expect(() => render("x", { live: true as never })).toThrow("createLiveRoot");
  });

  test("foreign host elements are rejected", () => {
    expect(() => render(<div />)).toThrow("Unsupported element <div>");
  });
});

describe("layout components", () => {
  test("Container", () => {
    expect(
      only(
        <Container accentColor="#5865f2" spoiler id={3}>
          text
        </Container>,
      ),
    ).toEqual({
      type: ComponentType.Container,
      id: 3,
      spoiler: true,
      accent_color: 0x5865f2,
      components: [{ type: ComponentType.TextDisplay, content: "text" }],
    });
  });

  test("Container accent colors", () => {
    const color = (accentColor: Parameters<typeof Container>[0]["accentColor"]) =>
      (only(<Container accentColor={accentColor}>a</Container>) as { accent_color?: number }).accent_color;
    expect(color(0x123456)).toBe(0x123456);
    expect(color("#ABCDEF")).toBe(0xabcdef);
    expect(color("blurple")).toBe(0x5865f2);
    expect(color("green")).toBe(0x57f287);
    expect(color("yellow")).toBe(0xfee75c);
    expect(color("fuchsia")).toBe(0xeb459e);
    expect(color("red")).toBe(0xed4245);
    expect(color("white")).toBe(0xffffff);
    expect(color("black")).toBe(0);
    expect(color(undefined)).toBeUndefined();
    expect(() => color("#123")).toThrow("Container accentColor");
    expect(() => color("mauve" as "red")).toThrow("Container accentColor");
    expect(() => color(0x1000000)).toThrow("Container accentColor");
  });

  test("Container child limits", () => {
    expect(() => render(<Container />)).toThrow("Container children must contain 1-40 items");
    expect(() =>
      render(
        <Container>
          <Label label="x">
            <Checkbox customId="c" />
          </Label>
        </Container>,
      ),
    ).toThrow("Label is not allowed inside Container");
    expect(() =>
      render(
        <Container>
          <Container>a</Container>
        </Container>,
      ),
    ).toThrow("Container is not allowed inside Container");
  });

  test("Separator", () => {
    expect(only(<Separator />)).toEqual({
      type: ComponentType.Separator,
      divider: true,
      spacing: SeparatorSpacingSize.Small,
    });
    expect(only(<Separator divider={false} spacing="large" id={9} />)).toEqual({
      type: ComponentType.Separator,
      divider: false,
      spacing: SeparatorSpacingSize.Large,
      id: 9,
    });
    expect(() => render(<Separator spacing={"huge" as "small"} />)).toThrow("Separator spacing");
    expect(() => render(<Separator>{"x" as never}</Separator>)).toThrow("Separator does not accept children");
  });

  test("Section with button and thumbnail accessories", () => {
    expect(
      only(
        <Section accessory={<Button customId="a" label="Go" />} id={1}>
          text
        </Section>,
      ),
    ).toEqual({
      type: ComponentType.Section,
      id: 1,
      components: [{ type: ComponentType.TextDisplay, content: "text" }],
      accessory: { type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: "a", label: "Go" },
    });
    expect(
      only(
        <Section accessory={<Thumbnail src="https://x/y.png" />}>
          <TextDisplay>one</TextDisplay>
          <TextDisplay>two</TextDisplay>
        </Section>,
      ),
    ).toEqual({
      type: ComponentType.Section,
      components: [
        { type: ComponentType.TextDisplay, content: "one" },
        { type: ComponentType.TextDisplay, content: "two" },
      ],
      accessory: { type: ComponentType.Thumbnail, media: { url: "https://x/y.png" } },
    });
  });

  test("Section accessory goes through the reconciler", () => {
    function Accessory(): ReactNode {
      const [label] = useState("Stateful");
      return <Button customId="a" label={label} />;
    }
    const section = only(<Section accessory={<Accessory />}>text</Section>) as {
      accessory: { label: string };
    };
    expect(section.accessory.label).toBe("Stateful");
  });

  test("Section validation", () => {
    const accessory = <Button customId="a" label="Go" />;
    expect(() => render(<Section accessory={accessory} />)).toThrow("Section text children must contain 1-3 items");
    expect(() =>
      render(
        <Section accessory={accessory}>
          <TextDisplay>1</TextDisplay>
          <TextDisplay>2</TextDisplay>
          <TextDisplay>3</TextDisplay>
          <TextDisplay>4</TextDisplay>
        </Section>,
      ),
    ).toThrow("Section text children must contain 1-3 items");
    expect(() =>
      render(
        <Section accessory={accessory}>
          <Separator />
        </Section>,
      ),
    ).toThrow("Separator is not allowed inside Section");
    expect(() => render(<Section accessory={null}>text</Section>)).toThrow(
      "Section accessory must contain exactly 1 item",
    );
    expect(() =>
      render(
        <Section
          accessory={
            <>
              {accessory}
              <Thumbnail src="https://x/y.png" />
            </>
          }
        >
          text
        </Section>,
      ),
    ).toThrow("Section accessory must contain exactly 1 item");
    expect(() => render(<Section accessory={<Separator />}>text</Section>)).toThrow(
      "Separator is not allowed inside Section accessory",
    );
    expect(() => render(<Section accessory="words">text</Section>)).toThrow(
      "text is not allowed inside Section accessory",
    );
  });

  test("TextDisplay limits", () => {
    expect(() => render(<TextDisplay />)).toThrow("TextDisplay content must be a string of 1-4000");
    expect(() => render(<TextDisplay>{"x".repeat(4001)}</TextDisplay>)).toThrow("TextDisplay content");
    expect(() =>
      render(
        <TextDisplay>
          <Separator />
        </TextDisplay>,
      ),
    ).toThrow("Separator is not allowed inside TextDisplay");
  });

  test("ActionRow", () => {
    expect(
      only(
        <ActionRow id={2}>
          <Button customId="a" label="A" />
        </ActionRow>,
      ),
    ).toEqual({
      type: ComponentType.ActionRow,
      id: 2,
      components: [{ type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: "a", label: "A" }],
    });
  });

  test("ActionRow nesting rules", () => {
    expect(() => render(<ActionRow />)).toThrow("ActionRow children must contain 1-5 items");
    expect(() => render(<ActionRow>{buttons(6)}</ActionRow>)).toThrow("ActionRow children must contain 1-5 items");
    expect(() =>
      render(
        <ActionRow>
          <Button customId="a" label="A" />
          <UserSelect customId="b" />
        </ActionRow>,
      ),
    ).toThrow("ActionRow must contain up to five buttons or a single select");
    expect(() =>
      render(
        <ActionRow>
          <UserSelect customId="a" />
          <RoleSelect customId="b" />
        </ActionRow>,
      ),
    ).toThrow("ActionRow must contain up to five buttons or a single select");
    expect(() => render(<ActionRow>words</ActionRow>)).toThrow("text is not allowed inside ActionRow");
    expect(() =>
      render(
        <ActionRow>
          <Bold>x</Bold>
        </ActionRow>,
      ),
    ).toThrow("Bold is not allowed inside ActionRow");
    expect(() =>
      render(
        <ActionRow>
          <TextDisplay>x</TextDisplay>
        </ActionRow>,
      ),
    ).toThrow("TextDisplay is not allowed inside ActionRow");
    expect(() =>
      render(
        <ActionRow>
          <TextInput customId="x" />
        </ActionRow>,
      ),
    ).toThrow("TextInput is not allowed inside ActionRow");
  });

  test("interactive components are not allowed at the root", () => {
    expect(() => render(<Button customId="a" label="A" />)).toThrow("Button is not allowed inside Message");
    expect(() => render(<UserSelect customId="a" />)).toThrow("UserSelect is not allowed inside Message");
    expect(() => render(<Thumbnail src="https://x" />)).toThrow("Thumbnail is not allowed inside Message");
    expect(() =>
      render(
        <Label label="x">
          <Checkbox customId="c" />
        </Label>,
      ),
    ).toThrow("Label is not allowed inside Message");
  });

  test("MediaGallery with children and items", () => {
    const expected = {
      type: ComponentType.MediaGallery,
      id: 4,
      items: [
        { media: { url: "https://x/a.png" }, description: "alt", spoiler: true },
        { media: { url: "https://x/b.png" } },
      ],
    };
    expect(
      only(
        <MediaGallery id={4}>
          <MediaItem src="https://x/a.png" description="alt" spoiler />
          <MediaItem src="https://x/b.png" />
        </MediaGallery>,
      ),
    ).toEqual(expected);
    expect(
      only(
        <MediaGallery
          id={4}
          items={[{ src: "https://x/a.png", description: "alt", spoiler: true }, { src: "https://x/b.png" }]}
        />,
      ),
    ).toEqual(expected);
  });

  test("MediaGallery validation", () => {
    const many = Array.from({ length: 11 }, () => ({ src: "https://x/a.png" }));
    expect(() => render(<MediaGallery items={many} />)).toThrow("MediaGallery items must contain 1-10 items");
    expect(() => render(<MediaGallery items={[]} />)).toThrow("MediaGallery items must contain 1-10 items");
    expect(() =>
      render(
        <MediaGallery>
          <Button customId="a" label="x" />
        </MediaGallery>,
      ),
    ).toThrow("Button is not allowed inside MediaGallery");
    expect(() =>
      render(
        <MediaGallery items={[{ src: "https://x" }]}>
          {(<MediaItem src="https://x" />) as never}
        </MediaGallery>,
      ),
    ).toThrow("MediaGallery accepts either items or MediaItem children");
    expect(() => render(<MediaItem src="https://x" />)).toThrow("MediaItem must be inside MediaGallery");
    expect(() =>
      render(<MediaGallery items={[{ src: "https://x", description: "d".repeat(1025) }]} />),
    ).toThrow("MediaGallery item description");
  });

  test("Thumbnail", () => {
    const section = only(
      <Section accessory={<Thumbnail id={8} src="https://x/a.png" description="alt" spoiler />}>t</Section>,
    ) as { accessory: unknown };
    expect(section.accessory).toEqual({
      type: ComponentType.Thumbnail,
      id: 8,
      media: { url: "https://x/a.png" },
      description: "alt",
      spoiler: true,
    });
    expect(() =>
      render(<Section accessory={<Thumbnail src="https://x" description={"d".repeat(1025)} />}>t</Section>),
    ).toThrow("Thumbnail description");
    expect(() => render(<Section accessory={<Thumbnail src="" />}>t</Section>)).toThrow("Thumbnail src");
  });

  test("File", () => {
    expect(only(<File id={5} src="attachment://a.txt" spoiler />)).toEqual({
      type: ComponentType.File,
      id: 5,
      file: { url: "attachment://a.txt" },
      spoiler: true,
    });
    expect(() => render(<File src="https://x/a.txt" />)).toThrow("File src must be a Buffer, a Uint8Array or an attachment://");
    expect(() => render(<File src="attachment://" />)).toThrow("File src must be a Buffer, a Uint8Array or an attachment://");
  });
});

describe("attachments", () => {
  test("Buffers are collected into files", () => {
    const file = Buffer.from("file");
    const thumb = Buffer.from("thumb");
    const media = new Uint8Array([1, 2, 3]);
    const result = render(
      <>
        <File src={file} name="report.txt" />
        <Section accessory={<Thumbnail src={thumb} name="thumb.png" />}>text</Section>
        <MediaGallery>
          <MediaItem src={media} name="media.png" />
        </MediaGallery>
      </>,
    );
    expect(result.components).toEqual([
      { type: ComponentType.File, file: { url: "attachment://report.txt" } },
      {
        type: ComponentType.Section,
        components: [{ type: ComponentType.TextDisplay, content: "text" }],
        accessory: { type: ComponentType.Thumbnail, media: { url: "attachment://thumb.png" } },
      },
      { type: ComponentType.MediaGallery, items: [{ media: { url: "attachment://media.png" } }] },
    ]);
    expect(result.files).toEqual([
      { attachment: file, name: "report.txt" },
      { attachment: thumb, name: "thumb.png" },
      { attachment: Buffer.from([1, 2, 3]), name: "media.png" },
    ]);
    expect(Buffer.isBuffer(result.files?.[2]?.attachment)).toBe(true);
  });

  test("identical attachments share one file and conflicts throw", () => {
    const result = render(
      <>
        <File src={Buffer.from("a")} name="a.txt" />
        <File src={Buffer.from("a")} name="a.txt" />
      </>,
    );
    expect(result.files).toHaveLength(1);
    expect(() =>
      render(
        <>
          <File src={Buffer.from("a")} name="a.txt" />
          <File src={Buffer.from("b")} name="a.txt" />
        </>,
      ),
    ).toThrow('File name "a.txt" is already used by a different attachment');
  });

  test("names are required and validated", () => {
    expect(() => render(<File src={Buffer.from("a")} name={undefined as never} />)).toThrow(
      "File requires a name when src is a Buffer",
    );
    expect(() => render(<File src={Buffer.from("a")} name="a b.txt" />)).toThrow('File name "a b.txt"');
    expect(() => render(<File src={5 as never} />)).toThrow("File src must be a URL");
  });

  test("no files key without buffers", () => {
    expect("files" in render(<File src="attachment://a.txt" />)).toBe(false);
  });
});

describe("Button", () => {
  test("styles", () => {
    const style = (name: "primary" | "secondary" | "success" | "danger") =>
      (inRow(<Button style={name} customId="a" label="x" />) as { style: number }).style;
    expect(style("primary")).toBe(ButtonStyle.Primary);
    expect(style("secondary")).toBe(ButtonStyle.Secondary);
    expect(style("success")).toBe(ButtonStyle.Success);
    expect(style("danger")).toBe(ButtonStyle.Danger);
    expect(() => inRow(<Button style={"pink" as "primary"} customId="a" label="x" />)).toThrow("Button style");
  });

  test("label from prop or children and disabled", () => {
    expect(inRow(<Button customId="a" label="L" disabled id={3} />)).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: "a",
      label: "L",
      disabled: true,
      id: 3,
    });
    expect(inRow(<Button customId="a">Count {5}</Button>)).toMatchObject({ label: "Count 5" });
    expect(() => inRow(<Button customId="a">{<Bold>x</Bold>}</Button>)).toThrow("Button children must be text");
  });

  test("route addressing", () => {
    expect(inRow(<Button route="mod/ban/[userId]" params={{ userId: "12" }} label="Ban" />)).toMatchObject({
      custom_id: "mod/ban/12",
    });
    expect(inRow(<Button route="mod/ping" label="Ping" />)).toMatchObject({ custom_id: "mod/ping" });
    expect(buildCustomId("mod/ban/[userId]", { userId: 7 })).toBe("mod/ban/7");
    expect(() => inRow(<Button route="mod/[id]" label="x" />)).toThrow('missing a value for param "id"');
  });

  test("addressing is exclusive and required", () => {
    expect(() => inRow(<Button {...loose({ route: "a", customId: "b", label: "x" })} />)).toThrow(
      "Button accepts only one of route, customId or onClick",
    );
    expect(() => inRow(<Button {...loose({ label: "x" })} />)).toThrow(
      "Button requires one of route, customId or onClick",
    );
    expect(() => inRow(<Button {...loose({ customId: "a", params: {}, label: "x" })} />)).toThrow(
      "Button params can only be used with route",
    );
    expect(() => inRow(<Button customId="~s:0" label="x" />)).toThrow("reserved for live sessions");
    expect(() => inRow(<Button customId={"x".repeat(101)} label="x" />)).toThrow("Button customId");
  });

  test("onClick throws in one-shot render", () => {
    expect(() => inRow(<Button onClick={() => {}} label="x" />)).toThrow(
      /Button has an onClick handler.*ctx\.reply.*createLiveRoot/,
    );
  });

  test("link style", () => {
    expect(inRow(<Button style="link" url="https://x" label="Open" />)).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      url: "https://x",
      label: "Open",
    });
    expect(() => inRow(<Button {...loose({ style: "link", url: "https://x", customId: "a", label: "x" })} />)).toThrow(
      "Button with style link cannot have route, customId, onClick or skuId",
    );
    expect(() => inRow(<Button {...loose({ style: "link", label: "x" })} />)).toThrow("Button url");
    expect(() => inRow(<Button style="link" url={"h".repeat(513)} label="x" />)).toThrow("Button url");
  });

  test("premium style", () => {
    expect(inRow(<Button style="premium" skuId="123" />)).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Premium,
      sku_id: "123",
    });
    expect(() => inRow(<Button {...loose({ style: "premium", skuId: "1", label: "x" })} />)).toThrow(
      "style premium cannot have a label",
    );
    expect(() => inRow(<Button {...loose({ style: "premium", skuId: "1", children: "x" })} />)).toThrow(
      "style premium cannot have children",
    );
    expect(() => inRow(<Button {...loose({ style: "premium", skuId: "1", onClick() {} })} />)).toThrow(
      "style premium cannot have route, customId or onClick",
    );
    expect(() => inRow(<Button {...loose({ style: "premium" })} />)).toThrow("Button skuId");
  });

  test("emoji forms", () => {
    const emoji = (value: Parameters<typeof Button>[0]["emoji"]) =>
      (inRow(<Button customId="a" emoji={value as never} />) as { emoji: unknown }).emoji;
    expect(emoji("😀")).toEqual({ name: "😀" });
    expect(emoji("<:party:123>")).toEqual({ name: "party", id: "123" });
    expect(emoji("<a:party:123>")).toEqual({ name: "party", id: "123", animated: true });
    expect(emoji({ id: "1", name: "x", animated: false })).toEqual({ id: "1", name: "x", animated: false });
    expect(emoji("112233445566778899")).toEqual({ id: "112233445566778899" });
  });

  test("label requirements", () => {
    expect(() => inRow(<Button customId="a" {...loose({} as never)} />)).toThrow("Button requires a label or emoji");
    expect(() => inRow(<Button customId="a" label={"x".repeat(81)} />)).toThrow("Button label");
    expect(() => inRow(<Button {...loose({ customId: "a", label: "x", children: "y" })} />)).toThrow(
      "Button accepts either label or children",
    );
  });
});

describe("selects", () => {
  const stringSelect = {
    type: ComponentType.StringSelect,
    custom_id: "s",
    placeholder: "Pick",
    min_values: 1,
    max_values: 2,
    disabled: true,
    id: 6,
    options: [
      { label: "A", value: "a", description: "first", emoji: { name: "😀" }, default: true },
      { label: "B", value: "b" },
    ],
  };

  test("StringSelect from Option children", () => {
    expect(
      inRow(
        <StringSelect customId="s" placeholder="Pick" minValues={1} maxValues={2} disabled id={6}>
          <Option label="A" value="a" description="first" emoji="😀" default />
          <Option label="B" value="b" />
        </StringSelect>,
      ),
    ).toEqual(stringSelect);
  });

  test("StringSelect from options", () => {
    expect(
      inRow(
        <StringSelect
          customId="s"
          placeholder="Pick"
          minValues={1}
          maxValues={2}
          disabled
          id={6}
          options={[
            { label: "A", value: "a", description: "first", emoji: "😀", default: true },
            { label: "B", value: "b" },
          ]}
        />,
      ),
    ).toEqual(stringSelect);
  });

  test("StringSelect with Option from a custom component", () => {
    function Choices({ values }: { values: string[] }): ReactNode {
      return values.map((value) => <Option key={value} label={value} value={value} />);
    }
    expect(
      inRow(
        <StringSelect customId="s">
          <Choices values={["x", "y"]} />
        </StringSelect>,
      ),
    ).toMatchObject({ options: [{ value: "x" }, { value: "y" }] });
  });

  test("route addressing", () => {
    expect(inRow(<UserSelect route="mod/pick/[id]" params={{ id: 1 }} />)).toMatchObject({
      custom_id: "mod/pick/1",
    });
  });

  test("StringSelect validation", () => {
    const options = [{ label: "A", value: "a" }];
    expect(() => inRow(<StringSelect customId="s" options={[]} />)).toThrow("StringSelect options must contain 1-25");
    expect(() =>
      inRow(<StringSelect customId="s" options={Array.from({ length: 26 }, (_, i) => ({ label: "l", value: `${i}` }))} />),
    ).toThrow("StringSelect options must contain 1-25");
    expect(() =>
      inRow(<StringSelect customId="s" options={[...options, { label: "B", value: "a" }]} />),
    ).toThrow('StringSelect option values must be unique; "a" appears twice');
    expect(() => inRow(<StringSelect customId="s" maxValues={2} options={options} />)).toThrow(
      "StringSelect maxValues cannot exceed the number of options",
    );
    expect(() => inRow(<StringSelect customId="s" minValues={2} maxValues={1} options={options} />)).toThrow(
      "StringSelect minValues cannot exceed maxValues",
    );
    expect(() => inRow(<StringSelect customId="s" placeholder={"p".repeat(151)} options={options} />)).toThrow(
      "StringSelect placeholder",
    );
    expect(() => inRow(<StringSelect customId="s" options={[{ label: "", value: "a" }]} />)).toThrow(
      "StringSelect option label",
    );
    expect(() =>
      inRow(
        <StringSelect customId="s" options={options}>
          {(<Option label="b" value="b" />) as never}
        </StringSelect>,
      ),
    ).toThrow("StringSelect accepts either options or Option children");
    expect(() =>
      inRow(
        <StringSelect customId="s">
          <Button customId="x" label="x" />
        </StringSelect>,
      ),
    ).toThrow("Button is not allowed inside StringSelect");
    expect(() =>
      render(
        <Container>
          <Option label="a" value="a" />
        </Container>,
      ),
    ).toThrow("Option must be inside StringSelect, RadioGroup or CheckboxGroup");
    expect(() => inRow(<StringSelect onSelect={() => {}} options={options} />)).toThrow(
      /StringSelect has an onSelect handler/,
    );
  });

  test("UserSelect", () => {
    expect(inRow(<UserSelect customId="u" defaultValues={["1", { id: "2", type: "user" }]} maxValues={2} />)).toEqual({
      type: ComponentType.UserSelect,
      custom_id: "u",
      max_values: 2,
      default_values: [
        { id: "1", type: "user" },
        { id: "2", type: "user" },
      ],
    });
  });

  test("RoleSelect", () => {
    expect(inRow(<RoleSelect customId="r" defaultValues={["1"]} placeholder="Role" />)).toEqual({
      type: ComponentType.RoleSelect,
      custom_id: "r",
      placeholder: "Role",
      default_values: [{ id: "1", type: "role" }],
    });
  });

  test("MentionableSelect", () => {
    expect(
      inRow(
        <MentionableSelect
          customId="m"
          maxValues={2}
          defaultValues={[
            { id: "1", type: "user" },
            { id: "2", type: "role" },
          ]}
        />,
      ),
    ).toEqual({
      type: ComponentType.MentionableSelect,
      custom_id: "m",
      max_values: 2,
      default_values: [
        { id: "1", type: "user" },
        { id: "2", type: "role" },
      ],
    });
    expect(() => inRow(<MentionableSelect customId="m" defaultValues={["1" as never]} />)).toThrow(
      "MentionableSelect defaultValues must be objects",
    );
  });

  test("ChannelSelect", () => {
    expect(
      inRow(<ChannelSelect customId="c" channelTypes={[ChannelType.GuildText]} defaultValues={["1"]} />),
    ).toEqual({
      type: ComponentType.ChannelSelect,
      custom_id: "c",
      channel_types: [ChannelType.GuildText],
      default_values: [{ id: "1", type: "channel" }],
    });
  });

  test("default value validation", () => {
    expect(() => inRow(<UserSelect customId="u" defaultValues={["1", "2"]} />)).toThrow(
      "UserSelect defaultValues must contain exactly 1 item",
    );
    expect(() =>
      inRow(<UserSelect customId="u" maxValues={2} defaultValues={["1", "1"]} />),
    ).toThrow("UserSelect default values must be unique");
    expect(() =>
      inRow(<RoleSelect customId="r" defaultValues={[{ id: "1", type: "user" as "role" }]} />),
    ).toThrow("RoleSelect default value type must be role");
    expect(() => inRow(<UserSelect customId="u" {...loose({ children: "x" })} />)).toThrow(
      "UserSelect does not accept children",
    );
  });
});

describe("limits across the tree", () => {
  test("40 total components", () => {
    const row = (start: number) => (
      <ActionRow key={start}>
        <Button customId={`a${start}`} label="x" />
      </ActionRow>
    );
    const twenty = Array.from({ length: 20 }, (_, index) => row(index));
    expect(components(twenty)).toHaveLength(20);
    const overflow = Array.from({ length: 21 }, (_, index) => row(index));
    expect(() => render(overflow)).toThrow("Message cannot contain more than 40 components");
  });

  test("unique custom ids", () => {
    expect(() =>
      render(
        <ActionRow>
          <Button customId="a" label="x" />
          <Button customId="a" label="y" />
        </ActionRow>,
      ),
    ).toThrow("Button has a duplicate customId: a");
  });

  test("unique ids except zero", () => {
    expect(() =>
      render(
        <>
          <TextDisplay id={1}>a</TextDisplay>
          <Separator id={1} />
        </>,
      ),
    ).toThrow("Separator has a duplicate component id: 1");
    expect(
      components(
        <>
          <TextDisplay id={0}>a</TextDisplay>
          <Separator id={0} />
        </>,
      ),
    ).toHaveLength(2);
    expect(() => render(<Separator id={-1} />)).toThrow("Separator id must be an integer");
    expect(() => render(<Separator id={1.5} />)).toThrow("Separator id must be an integer");
  });
});

describe("text collapse and whitespace", () => {
  test("collapses strings, numbers and inline elements at the root", () => {
    expect(
      components(
        <>
          Hello <Bold>world</Bold> {42}
        </>,
      ),
    ).toEqual([{ type: ComponentType.TextDisplay, content: "Hello **world** 42" }]);
  });

  test("collapses in Message, Container and Section", () => {
    expect(
      components(
        <Message>
          a <Italic>b</Italic>
        </Message>,
      ),
    ).toEqual([{ type: ComponentType.TextDisplay, content: "a *b*" }]);
    expect(
      only(
        <Container>
          a <Italic>b</Italic>
        </Container>,
      ),
    ).toMatchObject({ components: [{ type: ComponentType.TextDisplay, content: "a *b*" }] });
    expect(
      only(
        <Section accessory={<Button customId="x" label="x" />}>
          a <Italic>b</Italic>
        </Section>,
      ),
    ).toMatchObject({ components: [{ type: ComponentType.TextDisplay, content: "a *b*" }] });
  });

  test("runs split at block elements", () => {
    expect(
      components(
        <Message>
          one
          <Separator />
          two <Bold>three</Bold>
        </Message>,
      ),
    ).toEqual([
      { type: ComponentType.TextDisplay, content: "one" },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: "two **three**" },
    ]);
  });

  test("whitespace between blocks produces nothing", () => {
    expect(
      components(
        <Message>
          {" "}
          <Separator />
          {"\n  "}
          <Separator />
          {"\t"}
        </Message>,
      ),
    ).toHaveLength(2);
    expect(
      only(
        <Container>
          {"  "}
          <Separator />
          {"  "}
        </Container>,
      ),
    ).toMatchObject({ components: [{ type: ComponentType.Separator }] });
    expect(
      inRow(
        <>
          {"  "}
          <Button customId="a" label="x" />
          {"  "}
        </>,
      ),
    ).toMatchObject({ custom_id: "a" });
    expect(
      components(
        <>
          <LineBreak />
          <Separator />
        </>,
      ),
    ).toHaveLength(1);
  });

  test("the edges of collapsed runs are trimmed and inner spaces kept", () => {
    expect(
      only(
        <>
          {"  "}
          <Bold>a</Bold> <Bold>b</Bold>
          {"  "}
        </>,
      ),
    ).toEqual({ type: ComponentType.TextDisplay, content: "**a** **b**" });
  });

  test("explicit TextDisplay and adjacent text stay separate", () => {
    expect(
      components(
        <>
          before
          <TextDisplay>inside</TextDisplay>
          after
        </>,
      ),
    ).toEqual([
      { type: ComponentType.TextDisplay, content: "before" },
      { type: ComponentType.TextDisplay, content: "inside" },
      { type: ComponentType.TextDisplay, content: "after" },
    ]);
  });
});

describe("inline text", () => {
  test("marks", () => {
    expect(content(<Bold>x</Bold>)).toBe("**x**");
    expect(content(<Italic>x</Italic>)).toBe("*x*");
    expect(content(<Underline>x</Underline>)).toBe("__x__");
    expect(content(<Strikethrough>x</Strikethrough>)).toBe("~~x~~");
    expect(content(<Spoiler>x</Spoiler>)).toBe("||x||");
    expect(content(<Code>x</Code>)).toBe("`x`");
    expect(content(<Code>a`b</Code>)).toBe("`` a`b ``");
    expect(
      content(
        <>
          a<Bold />b
        </>,
      ),
    ).toBe("ab");
  });

  test("marks nest", () => {
    expect(
      content(
        <Bold>
          a <Italic>b <Underline>c</Underline></Italic>
        </Bold>,
      ),
    ).toBe("**a *b __c__***");
  });

  test("CodeBlock", () => {
    expect(content(<CodeBlock language="ts">const a = 1;</CodeBlock>)).toBe("```ts\nconst a = 1;\n```");
    expect(content(<CodeBlock>{"a\n"}</CodeBlock>)).toBe("```\na\n```");
  });

  test("Quote", () => {
    expect(content(<Quote>{"one\ntwo"}</Quote>)).toBe("> one\n> two");
    expect(
      content(
        <Quote>
          a<LineBreak />
          <Bold>b</Bold>
        </Quote>,
      ),
    ).toBe("> a\n> **b**");
  });

  test("Heading", () => {
    expect(content(<Heading>x</Heading>)).toBe("# x");
    expect(content(<Heading level={1}>x</Heading>)).toBe("# x");
    expect(content(<Heading level={2}>x</Heading>)).toBe("## x");
    expect(content(<Heading level={3}>x</Heading>)).toBe("### x");
    expect(() => content(<Heading level={4 as 1}>x</Heading>)).toThrow("Heading level must be 1, 2 or 3");
  });

  test("Subtext", () => {
    expect(content(<Subtext>x</Subtext>)).toBe("-# x");
    expect(content(<Subtext>{"a\nb"}</Subtext>)).toBe("-# a\n-# b");
  });

  test("Link", () => {
    expect(content(<Link href="https://x">text</Link>)).toBe("[text](https://x)");
    expect(content(<Link href="https://x" />)).toBe("https://x");
    expect(
      content(
        <Link href="https://x">
          <Bold>b</Bold>
        </Link>,
      ),
    ).toBe("[**b**](https://x)");
    expect(() => content(<Link href={5 as never}>x</Link>)).toThrow("Link href");
  });

  test("List", () => {
    expect(
      content(
        <List>
          <ListItem>a</ListItem>
          <ListItem>
            <Bold>b</Bold>
          </ListItem>
        </List>,
      ),
    ).toBe("- a\n- **b**");
    expect(
      content(
        <List ordered>
          <ListItem>a</ListItem>
          <ListItem>b</ListItem>
        </List>,
      ),
    ).toBe("1. a\n2. b");
    expect(
      content(
        <List>
          <ListItem>
            a
            <List ordered>
              <ListItem>b</ListItem>
            </List>
          </ListItem>
          <ListItem>c</ListItem>
        </List>,
      ),
    ).toBe("- a\n  1. b\n- c");
    expect(() => content(<List>text</List>)).toThrow("List children must be ListItem");
    expect(() => content(<ListItem>text</ListItem>)).toThrow("ListItem must be inside List");
  });

  test("mentions", () => {
    expect(content(<UserMention id="1" />)).toBe("<@1>");
    expect(content(<RoleMention id="2" />)).toBe("<@&2>");
    expect(content(<ChannelMention id="3" />)).toBe("<#3>");
    expect(() => content(<UserMention id={undefined as never} />)).toThrow("UserMention id");
  });

  test("Timestamp", () => {
    const date = new Date(1_700_000_000_000);
    expect(content(<Timestamp date={date} />)).toBe("<t:1700000000>");
    expect(content(<Timestamp date={date} style="R" />)).toBe("<t:1700000000:R>");
    expect(content(<Timestamp date={1_700_000_000_000} style="F" />)).toBe("<t:1700000000:F>");
    expect(content(<Timestamp date="2023-11-14T22:13:20.000Z" />)).toBe("<t:1700000000>");
    expect(() => content(<Timestamp date="never" />)).toThrow("Timestamp date");
    expect(() => content(<Timestamp date={date} style={"x" as "R"} />)).toThrow("Timestamp style");
  });

  test("Emoji", () => {
    expect(content(<Emoji name="😀" />)).toBe("😀");
    expect(content(<Emoji name="party" id="1" />)).toBe("<:party:1>");
    expect(content(<Emoji name="party" id="1" animated />)).toBe("<a:party:1>");
    expect(content(<Emoji emoji="😀" />)).toBe("😀");
    expect(content(<Emoji emoji="<a:party:1>" />)).toBe("<a:party:1>");
    expect(content(<Emoji emoji={{ name: "x", id: "2" }} />)).toBe("<:x:2>");
  });

  test("LineBreak", () => {
    expect(
      content(
        <>
          a
          <LineBreak />b
        </>,
      ),
    ).toBe("a\nb");
  });

  test("block-level text starts on its own line", () => {
    expect(
      content(
        <>
          intro
          <Heading level={2}>Title</Heading>
          body
          <Quote>said</Quote> <Subtext>small</Subtext>
        </>,
      ),
    ).toBe("intro\n## Title\nbody\n> said\n-# small");
  });

  test("function components returning inline elements work in TextDisplay", () => {
    function Name({ value }: { value: string }): ReactNode {
      return (
        <>
          <Bold>{value}</Bold>!
        </>
      );
    }
    expect(
      content(
        <>
          Hi <Name value="Ada" />
        </>,
      ),
    ).toBe("Hi **Ada**!");
    expect(components(<Name value="Bob" />)).toEqual([{ type: ComponentType.TextDisplay, content: "**Bob**!" }]);
  });

  test("escapeMarkdown", () => {
    expect(escapeMarkdown("**a** _b_ `c`")).toBe("\\*\\*a\\*\\* \\_b\\_ \\`c\\`");
    expect(escapeMarkdown("# h")).toBe("\\# h");
    expect(escapeMarkdown("> q")).toBe("\\> q");
    expect(escapeMarkdown("-# s")).toBe("\\-# s");
    expect(escapeMarkdown("[a](https://b)")).toBe("\\[a](https://b)");
  });
});

describe("React features", () => {
  test("custom function components compose", () => {
    function Card({ title, children }: { title: string; children: ReactNode }): ReactNode {
      return (
        <Container accentColor="red">
          <Heading>{title}</Heading>
          {children}
        </Container>
      );
    }
    expect(
      only(
        <Card title="T">
          <Separator />
        </Card>,
      ),
    ).toMatchObject({
      type: ComponentType.Container,
      accent_color: 0xed4245,
      components: [{ content: "# T" }, { type: ComponentType.Separator }],
    });
  });

  test("context", () => {
    const Theme = createContext("light");
    function Current(): ReactNode {
      return <TextDisplay>{useContext(Theme)}</TextDisplay>;
    }
    expect(
      only(
        <Theme.Provider value="dark">
          <Current />
        </Theme.Provider>,
      ),
    ).toEqual({ type: ComponentType.TextDisplay, content: "dark" });
  });

  test("useState initial value", () => {
    function Counter(): ReactNode {
      const [count] = useState(() => 41 + 1);
      return <TextDisplay>{count}</TextDisplay>;
    }
    expect(only(<Counter />)).toEqual({ type: ComponentType.TextDisplay, content: "42" });
  });

  test("other hooks", () => {
    function View(): ReactNode {
      const id = useId();
      const reference = useRef(2);
      const [count] = useReducer((value: number) => value + 1, 40);
      const doubled = useMemo(() => count * reference.current, [count]);
      const deferred = useDeferredValue(doubled);
      const [pending] = useTransition();
      return (
        <TextDisplay>
          {deferred} {String(pending)} {String(id.length > 0)}
        </TextDisplay>
      );
    }
    expect(only(<View />)).toEqual({ type: ComponentType.TextDisplay, content: "80 false true" });
  });

  test("layout effects update before serialising and effects clean up", () => {
    const events: string[] = [];
    function View(): ReactNode {
      const [value, setValue] = useState("first");
      useLayoutEffect(() => {
        setValue("second");
      }, []);
      useEffect(() => {
        events.push("mount");
        return () => {
          events.push("cleanup");
        };
      }, []);
      return <TextDisplay>{value}</TextDisplay>;
    }
    expect(only(<View />)).toEqual({ type: ComponentType.TextDisplay, content: "second" });
    expect(events).toEqual(["mount", "cleanup"]);
  });

  test("hidden Activity content is skipped", () => {
    expect(
      components(
        <>
          <TextDisplay>shown</TextDisplay>
          <Activity mode="hidden">
            <TextDisplay>hidden</TextDisplay>
          </Activity>
        </>,
      ),
    ).toEqual([{ type: ComponentType.TextDisplay, content: "shown" }]);
  });

  test("renders are independent", () => {
    expect(only(<TextDisplay>a</TextDisplay>)).toEqual({ type: ComponentType.TextDisplay, content: "a" });
    expect(only(<TextDisplay>b</TextDisplay>)).toEqual({ type: ComponentType.TextDisplay, content: "b" });
  });
});

describe("suspense", () => {
  test("render throws if the tree suspends without a boundary", () => {
    const pending = new Promise<string>(() => {});
    function Reader(): ReactNode {
      return <TextDisplay>{use(pending)}</TextDisplay>;
    }
    expect(() => render(<Reader />)).toThrow("render() does not support suspended components");
  });

  test("render throws if the tree suspends inside a user boundary", () => {
    const pending = new Promise<string>(() => {});
    function Reader(): ReactNode {
      return <TextDisplay>{use(pending)}</TextDisplay>;
    }
    expect(() =>
      render(
        <Suspense fallback={<TextDisplay>loading</TextDisplay>}>
          <Reader />
        </Suspense>,
      ),
    ).toThrow("render() does not support suspended components");
  });

  test("renderModal throws if the tree suspends", () => {
    const pending = new Promise<string>(() => {});
    function Reader(): ReactNode {
      return <TextDisplay>{use(pending)}</TextDisplay>;
    }
    expect(() => renderModal(<Reader />, { customId: "m", title: "t" })).toThrow(
      "renderModal() does not support suspended components",
    );
  });

  test("renderAsync resolves without suspense", async () => {
    expect(await renderAsync(<TextDisplay>now</TextDisplay>)).toEqual({
      flags: MessageFlags.IsComponentsV2,
      components: [{ type: ComponentType.TextDisplay, content: "now" }],
    });
  });

  test("renderAsync waits for use() without a boundary", async () => {
    const promise = new Promise<string>((resolve) => setTimeout(() => resolve("later"), 5));
    function Reader(): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    expect((await renderAsync(<Reader />)).components).toEqual([
      { type: ComponentType.TextDisplay, content: "later" },
    ]);
  });

  test("renderAsync replaces fallbacks, including nested ones", async () => {
    const outer = new Promise<string>((resolve) => setTimeout(() => resolve("outer"), 5));
    const inner = new Promise<string>((resolve) => setTimeout(() => resolve("inner"), 15));
    function Reader({ promise }: { promise: Promise<string> }): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    const result = await renderAsync(
      <Suspense fallback={<TextDisplay>loading outer</TextDisplay>}>
        <Reader promise={outer} />
        <Suspense fallback={<TextDisplay>loading inner</TextDisplay>}>
          <Reader promise={inner} />
        </Suspense>
      </Suspense>,
    );
    expect(result.components).toEqual([
      { type: ComponentType.TextDisplay, content: "outer" },
      { type: ComponentType.TextDisplay, content: "inner" },
    ]);
  });

  test("renderAsync does not wait for React fallback throttling", async () => {
    const promise = new Promise<string>((resolve) => setTimeout(() => resolve("fast"), 1));
    function Reader(): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    const start = performance.now();
    await renderAsync(
      <Suspense fallback={<TextDisplay>loading</TextDisplay>}>
        <Reader />
      </Suspense>,
    );
    expect(performance.now() - start).toBeLessThan(250);
  });

  test("renderAsync rejects when the promise rejects", async () => {
    const promise = new Promise<string>((_, reject) => setTimeout(() => reject(THROWN), 1));
    function Reader(): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    await expect(renderAsync(<Reader />)).rejects.toBe(THROWN);
  });

  test("renderAsync propagates validation errors", async () => {
    await expect(renderAsync(<Button customId="a" label="x" />)).rejects.toThrow(
      "Button is not allowed inside Message",
    );
  });
});

describe("errors", () => {
  test("component errors propagate unchanged", () => {
    let caught: unknown;
    try {
      render(<Thrower />);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(THROWN);
  });

  test("component errors propagate from renderAsync and renderModal", async () => {
    await expect(renderAsync(<Thrower />)).rejects.toBe(THROWN);
    expect(() => renderModal(<Thrower />, { customId: "m", title: "t" })).toThrow(THROWN);
  });

  test("error boundaries catch errors silently", () => {
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      override state = { failed: false };
      static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
      }
      override render(): ReactNode {
        return this.state.failed ? <TextDisplay>recovered</TextDisplay> : this.props.children;
      }
    }
    expect(
      only(
        <Boundary>
          <Thrower />
        </Boundary>,
      ),
    ).toEqual({ type: ComponentType.TextDisplay, content: "recovered" });
  });

  test("errors thrown in effects propagate", () => {
    function View(): ReactNode {
      useEffect(() => {
        throw THROWN;
      }, []);
      return <TextDisplay>x</TextDisplay>;
    }
    expect(() => render(<View />)).toThrow(THROWN);
  });

  test("rendering again after an error works", () => {
    expect(() => render(<Thrower />)).toThrow(THROWN);
    expect(only(<TextDisplay>ok</TextDisplay>)).toEqual({ type: ComponentType.TextDisplay, content: "ok" });
  });

  test("render inside a component render is rejected", () => {
    function Nested(): ReactNode {
      render(<TextDisplay>inner</TextDisplay>);
      return <TextDisplay>outer</TextDisplay>;
    }
    expect(() => render(<Nested />)).toThrow("render() cannot be called while React is rendering");
  });
});

describe("modals", () => {
  test("renderModal with options", () => {
    expect(
      renderModal(
        <>
          <TextDisplay>Fill this</TextDisplay>
          <Label label="Name" description="Your name" id={1}>
            <TextInput customId="name" />
          </Label>
        </>,
        { customId: "m", title: "Title" },
      ),
    ).toEqual({
      custom_id: "m",
      title: "Title",
      components: [
        { type: ComponentType.TextDisplay, content: "Fill this" },
        {
          type: ComponentType.Label,
          id: 1,
          label: "Name",
          description: "Your name",
          component: { type: ComponentType.TextInput, custom_id: "name", style: TextInputStyle.Short },
        },
      ],
    });
  });

  test("renderModal with a root Modal and no options", () => {
    const body = (
      <Label label="Name">
        <TextInput customId="name" />
      </Label>
    );
    expect(
      renderModal(
        <Modal customId="m" title="Title">
          {body}
        </Modal>,
      ),
    ).toMatchObject({ custom_id: "m", title: "Title" });
    expect(
      renderModal(
        <Modal route="f/ban/[id]" params={{ id: 3 }} title="Ban">
          {body}
        </Modal>,
      ),
    ).toMatchObject({ custom_id: "f/ban/3", title: "Ban" });
  });

  test("Modal works through a function component", () => {
    function Wrapper(): ReactNode {
      return (
        <Modal customId="wrapped" title="W">
          intro text
        </Modal>
      );
    }
    expect(renderModal(<Wrapper />)).toEqual({
      custom_id: "wrapped",
      title: "W",
      components: [{ type: ComponentType.TextDisplay, content: "intro text" }],
    });
  });

  test("modal validation", () => {
    const field = (id: string) => (
      <Label key={id} label="L">
        <TextInput customId={id} />
      </Label>
    );
    const options = { customId: "m", title: "T" };
    expect(() => renderModal(null, options)).toThrow("Modal components must contain 1-5 items");
    expect(() => renderModal(["a", "b", "c", "d", "e", "f"].map(field), options)).toThrow(
      "Modal components must contain 1-5 items",
    );
    expect(() => renderModal(<Separator />, options)).toThrow("Separator is not allowed in a modal");
    expect(() => renderModal(<TextInput customId="a" />, options)).toThrow("TextInput is not allowed inside Modal");
    expect(() => renderModal(field("a"), { customId: "m", title: "t".repeat(46) })).toThrow("Modal title");
    expect(() => renderModal(field("a"), { customId: "x".repeat(101), title: "t" })).toThrow("Modal customId");
    expect(() => renderModal(<TextDisplay>a</TextDisplay>)).toThrow("renderModal requires a customId and title");
    expect(() => renderModal(<Message>a</Message>, options)).toThrow("Message cannot be rendered with renderModal");
    expect(() =>
      renderModal(
        <>
          <Modal customId="a" title="t">
            x
          </Modal>
          <TextDisplay>y</TextDisplay>
        </>,
      ),
    ).toThrow("Modal must be the only element at the root");
    expect(() =>
      renderModal(
        <Modal customId="a" title="t">
          <Modal customId="b" title="t">
            x
          </Modal>
        </Modal>,
      ),
    ).toThrow("Modal must be the root");
    expect(() => render(<Separator />, undefined)).not.toThrow();
  });

  test("Label rules", () => {
    const options = { customId: "m", title: "T" };
    expect(() => renderModal(<Label label="x" />, options)).toThrow("Label children must contain exactly 1 item");
    expect(() =>
      renderModal(
        <Label label="x">
          <TextInput customId="a" />
          <TextInput customId="b" />
        </Label>,
        options,
      ),
    ).toThrow("Label children must contain exactly 1 item");
    expect(() =>
      renderModal(
        <Label label="x">
          <Button customId="a" label="x" />
        </Label>,
        options,
      ),
    ).toThrow("Button is not allowed in a modal");
    expect(() =>
      renderModal(
        <Label label="x">
          <TextDisplay>a</TextDisplay>
        </Label>,
        options,
      ),
    ).toThrow("TextDisplay is not allowed inside Label");
    expect(() =>
      renderModal(
        <Label label={"l".repeat(46)}>
          <TextInput customId="a" />
        </Label>,
        options,
      ),
    ).toThrow("Label text");
    expect(() =>
      renderModal(
        <Label label="l" description={"d".repeat(101)}>
          <TextInput customId="a" />
        </Label>,
        options,
      ),
    ).toThrow("Label description");
  });

  test("TextInput", () => {
    expect(
      inModal(
        <TextInput
          customId="i"
          style="paragraph"
          placeholder="p"
          required={false}
          minLength={1}
          maxLength={10}
          value="v"
          id={2}
        />,
      ),
    ).toEqual({
      type: ComponentType.TextInput,
      custom_id: "i",
      style: TextInputStyle.Paragraph,
      placeholder: "p",
      required: false,
      min_length: 1,
      max_length: 10,
      value: "v",
      id: 2,
    });
    expect(inModal(<TextInput customId="i">prefilled {1}</TextInput>)).toMatchObject({ value: "prefilled 1" });
  });

  test("TextInput validation", () => {
    expect(() => inModal(<TextInput customId="i" minLength={5} maxLength={1} />)).toThrow(
      "TextInput minLength cannot exceed maxLength",
    );
    expect(() => inModal(<TextInput customId="i" maxLength={4001} />)).toThrow("TextInput maxLength");
    expect(() => inModal(<TextInput customId="i" placeholder={"p".repeat(101)} />)).toThrow("TextInput placeholder");
    expect(() => inModal(<TextInput customId="i" style={"long" as "short"} />)).toThrow("TextInput style");
    expect(() => inModal(<TextInput {...loose({ customId: "i", value: "a", children: "b" })} />)).toThrow(
      "TextInput accepts either value or children",
    );
  });

  test("selects in modals", () => {
    expect(
      inModal(
        <StringSelect customId="s" required={false}>
          <Option label="A" value="a" />
        </StringSelect>,
      ),
    ).toEqual({
      type: ComponentType.StringSelect,
      custom_id: "s",
      required: false,
      options: [{ label: "A", value: "a" }],
    });
    expect(() => inModal(<UserSelect customId="u" disabled />)).toThrow("UserSelect in a modal cannot have a disabled");
    expect(() => inModal(<UserSelect customId="u" minValues={0} />)).toThrow(
      "UserSelect minValues must be at least 1 when required",
    );
    expect(inModal(<UserSelect customId="u" minValues={0} required={false} />)).toMatchObject({ min_values: 0 });
  });

  test("FileUpload", () => {
    expect(
      inModal(<FileUpload customId="f" minValues={1} maxValues={3} fileTypes={["image", ".pdf"]} required id={7} />),
    ).toEqual({
      type: ComponentType.FileUpload,
      custom_id: "f",
      min_values: 1,
      max_values: 3,
      file_types: ["image", ".pdf"],
      required: true,
      id: 7,
    });
    expect(() => inModal(<FileUpload customId="f" maxValues={11} />)).toThrow("FileUpload maxValues");
    expect(() => inModal(<FileUpload customId="f" fileTypes={["nope" as "image"]} />)).toThrow("FileUpload fileTypes");
    expect(() => inModal(<FileUpload customId="f" fileTypes={[]} />)).toThrow("FileUpload fileTypes");
    expect(() => inModal(<FileUpload customId="f" minValues={0} />)).toThrow(
      "FileUpload minValues must be at least 1",
    );
  });

  test("RadioGroup with children and options", () => {
    const expected = {
      type: ComponentType.RadioGroup,
      custom_id: "r",
      required: true,
      options: [
        { label: "A", value: "a", description: "d", default: true },
        { label: "B", value: "b" },
      ],
    };
    expect(
      inModal(
        <RadioGroup customId="r" required>
          <Option label="A" value="a" description="d" default />
          <Option label="B" value="b" />
        </RadioGroup>,
      ),
    ).toEqual(expected);
    expect(
      inModal(
        <RadioGroup
          customId="r"
          required
          options={[
            { label: "A", value: "a", description: "d", default: true },
            { label: "B", value: "b" },
          ]}
        />,
      ),
    ).toEqual(expected);
  });

  test("RadioGroup validation", () => {
    expect(() => inModal(<RadioGroup customId="r" options={[{ label: "A", value: "a" }]} />)).toThrow(
      "RadioGroup options must contain 2-10 items",
    );
    expect(() =>
      inModal(
        <RadioGroup
          customId="r"
          options={[
            { label: "A", value: "a", default: true },
            { label: "B", value: "b", default: true },
          ]}
        />,
      ),
    ).toThrow("RadioGroup can have only one default option");
    expect(() =>
      inModal(
        <RadioGroup customId="r">
          <Option label="A" value="a" emoji="😀" />
          <Option label="B" value="b" />
        </RadioGroup>,
      ),
    ).toThrow("RadioGroup options do not support emoji");
  });

  test("CheckboxGroup", () => {
    expect(
      inModal(
        <CheckboxGroup customId="c" minValues={1} maxValues={2} id={1}>
          <Option label="A" value="a" />
          <Option label="B" value="b" default />
        </CheckboxGroup>,
      ),
    ).toEqual({
      type: ComponentType.CheckboxGroup,
      custom_id: "c",
      min_values: 1,
      max_values: 2,
      id: 1,
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b", default: true },
      ],
    });
    expect(() => inModal(<CheckboxGroup customId="c" options={[]} />)).toThrow(
      "CheckboxGroup options must contain 1-10 items",
    );
    expect(() =>
      inModal(<CheckboxGroup customId="c" maxValues={2} options={[{ label: "A", value: "a" }]} />),
    ).toThrow("CheckboxGroup maxValues");
  });

  test("Checkbox", () => {
    expect(inModal(<Checkbox customId="c" default id={1} />)).toEqual({
      type: ComponentType.Checkbox,
      custom_id: "c",
      default: true,
      id: 1,
    });
  });

  test("custom ids are unique within a modal", () => {
    expect(() =>
      renderModal(
        <>
          <Label label="a">
            <TextInput customId="x" />
          </Label>
          <Label label="b">
            <TextInput customId="x" />
          </Label>
        </>,
        { customId: "m", title: "T" },
      ),
    ).toThrow("TextInput has a duplicate customId: x");
  });
});
