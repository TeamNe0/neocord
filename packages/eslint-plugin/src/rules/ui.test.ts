import { describe, it } from "bun:test";
import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import noEmbedBuilders from "./no-embed-builders.ts";
import noTextInActionRow from "./no-text-in-action-row.ts";
import preferRouteProp from "./prefer-route-prop.ts";
import validComponentNesting from "./valid-component-nesting.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const filename = "src/ui.tsx";
const imports = `import {
  ActionRow, Button, Checkbox, CheckboxGroup, Container, FileUpload, Label, MediaGallery, MediaItem, Message, Modal,
  Option, RadioGroup, RoleSelect, Section, StringSelect, TextDisplay, TextInput, Thumbnail, UserSelect, Bold,
} from "@neocord/react";\n`;

function jsx(code: string): { filename: string; code: string } {
  return { filename, code: `${imports}const node = ${code};` };
}

function invalid(code: string, ...messageIds: string[]) {
  return { ...jsx(code), errors: messageIds.map((messageId) => ({ messageId })) };
}

const buttons = (count: number) => "<Button />".repeat(count);

tester.run("no-embed-builders", noEmbedBuilders, {
  valid: [
    { filename, code: 'import { Message } from "@neocord/react";' },
    { filename, code: 'import { Client, AttachmentBuilder, SlashCommandBuilder } from "discord.js";' },
    { filename, code: 'import type { EmbedBuilder } from "discord.js";' },
    { filename, code: 'import { type ButtonBuilder } from "discord.js";' },
    { filename, code: 'import { EmbedBuilder } from "./my-embed"; new EmbedBuilder();' },
    { filename, code: "new Local.EmbedBuilder();" },
    { filename, code: "channel.send({ content: 'x' });" },
    { filename, code: "channel.send({ ...render(node) });" },
    { filename, code: "channel.send({ components: result.components, flags: result.flags });" },
    { filename, code: "const { components, flags } = render(node); channel.send({ components, flags });" },
    { filename, code: "interaction.editReply({ components: [], embeds: [] });" },
    { filename, code: "api.create({ embeds: [embed], components: [row] });" },
  ],
  invalid: [
    {
      filename,
      code: 'import { EmbedBuilder, ActionRowBuilder as Row } from "discord.js";',
      errors: [
        { messageId: "builder", data: { name: "EmbedBuilder" } },
        { messageId: "builder", data: { name: "ActionRowBuilder" } },
      ],
    },
    { filename, code: 'import { ButtonBuilder } from "@discordjs/builders";', errors: [{ messageId: "builder" }] },
    {
      filename,
      code: 'import { StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, ContainerBuilder, SectionBuilder, TextDisplayBuilder } from "discord.js";',
      errors: 7,
    },
    {
      filename,
      code: 'import * as Discord from "discord.js"; new Discord.EmbedBuilder();',
      errors: [{ messageId: "builder", data: { name: "EmbedBuilder" } }],
    },
    {
      filename,
      code: 'import Discord from "discord.js"; const b = Discord.ButtonBuilder;',
      errors: [{ messageId: "builder", data: { name: "ButtonBuilder" } }],
    },
    {
      filename,
      code: "interaction.reply({ embeds: [embed] });",
      errors: [{ messageId: "rawPayload", data: { property: "embeds" } }],
    },
    {
      filename,
      code: "channel.send({ components: [row] });",
      errors: [{ messageId: "rawPayload", data: { property: "components" } }],
    },
    { filename, code: "message.edit({ embeds: list });", errors: [{ messageId: "rawPayload" }] },
    { filename, code: "interaction.editReply({ components: [row] });", errors: [{ messageId: "rawPayload" }] },
    { filename, code: "interaction.followUp({ embeds: [a], components: [b] });", errors: 2 },
  ],
});

tester.run("valid-component-nesting", validComponentNesting, {
  valid: [
    jsx("<Message><ActionRow><Button /><Button /></ActionRow></Message>"),
    jsx(`<ActionRow>${buttons(5)}</ActionRow>`),
    jsx("<ActionRow><StringSelect><Option /></StringSelect></ActionRow>"),
    jsx("<ActionRow><><Button /></></ActionRow>"),
    jsx("<Section accessory={<Button />}>Hello <Bold>world</Bold></Section>"),
    jsx("<Section accessory={<Thumbnail />}><TextDisplay>Hi</TextDisplay></Section>"),
    jsx("<Section accessory={custom}>Hello</Section>"),
    jsx('<Modal><Label label="x"><TextInput /></Label></Modal>'),
    jsx('<Label label="x"><StringSelect><Option /></StringSelect></Label>'),
    jsx('<Label label="x"><UserSelect /></Label>'),
    jsx('<Label label="x"><RadioGroup><Option /><Option /></RadioGroup></Label>'),
    jsx('<Label label="x"><CheckboxGroup><Option /></CheckboxGroup></Label>'),
    jsx('<Label label="x"><Checkbox /></Label>'),
    jsx('<Label label="x"><FileUpload /></Label>'),
    jsx('<Label label="x"><Custom /></Label>'),
    jsx('<Label label="x">{field}</Label>'),
    jsx("<MediaGallery><MediaItem /><MediaItem /></MediaGallery>"),
    jsx("<Message>Text</Message>"),
    jsx("<Custom><Message /></Custom>"),
    jsx("<Button />"),
    jsx("<><Button /></>"),
    jsx("<Custom><Button /></Custom>"),
    jsx("<Message>{cond && <Button />}</Message>"),
    jsx("<Message>{items.map(() => <Button />)}</Message>"),
    jsx(`<ActionRow>{list}${buttons(5)}</ActionRow>`),
    jsx("<ActionRow><Custom /><StringSelect /></ActionRow>"),
    { filename, code: 'import { Button } from "./mine"; const node = <Message><Button /></Message>;' },
    { filename, code: "const node = <Message><Button /></Message>;" },
    { filename, code: 'import { Fragment } from "react"; import { ActionRow, Button } from "@neocord/react"; const node = <ActionRow><Fragment><Button /></Fragment></ActionRow>;' },
    { filename, code: 'import { Button as B, ActionRow as Row } from "@neocord/react"; const node = <Row><B /></Row>;' },
    { filename, code: 'import * as N from "@neocord/react"; const node = <N.ActionRow><N.Button /></N.ActionRow>;' },
    { filename, code: 'import { Button, Container } from "@neocord/react"; function F({ Container }) { return <Container><Button /></Container>; }' },
  ],
  invalid: [
    invalid("<Message><Button /></Message>", "misplaced"),
    invalid("<Container><StringSelect /></Container>", "misplaced"),
    invalid("<Section><Button /></Section>", "misplaced"),
    invalid("<Section accessory={<Button />}><Thumbnail /></Section>", "sectionInvalidChild"),
    invalid("<Section accessory={<TextDisplay />}>Hi</Section>", "sectionInvalidAccessory"),
    invalid("<Message><><Button /></></Message>", "misplaced"),
    invalid("<ActionRow><Button /><StringSelect /></ActionRow>", "rowMixed"),
    invalid(`<ActionRow>${buttons(6)}</ActionRow>`, "rowTooManyButtons"),
    invalid("<ActionRow><UserSelect /><RoleSelect /></ActionRow>", "rowSelectNotAlone"),
    invalid("<ActionRow><TextDisplay /></ActionRow>", "rowInvalidChild"),
    invalid('<Label label="x"></Label>', "labelNoControl"),
    invalid('<Label label="x">Text</Label>', "labelNoControl"),
    invalid('<Label label="x"><TextInput /><TextInput /></Label>', "labelManyControls"),
    invalid('<Label label="x"><TextDisplay /></Label>', "labelNoControl"),
    invalid("<Message><Option /></Message>", "misplaced"),
    invalid("<UserSelect><Option /></UserSelect>", "misplaced"),
    invalid("<Container><MediaItem /></Container>", "misplaced"),
    invalid("<Modal><TextInput /></Modal>", "misplaced"),
    invalid("<Container><Message /></Container>", "messageNotRoot"),
    invalid("<Message><Message /></Message>", "messageNotRoot"),
    {
      filename,
      code: 'import { Button as B, Message as M } from "@neocord/react"; const node = <M><B /></M>;',
      errors: [{ messageId: "misplaced", data: { component: "Button", parent: "Message", allowed: "<ActionRow> or the accessory prop of <Section>" } }],
    },
    {
      filename,
      code: 'import * as N from "@neocord/react"; const node = <N.Message><N.Button /></N.Message>;',
      errors: [{ messageId: "misplaced" }],
    },
  ],
});

tester.run("prefer-route-prop", preferRouteProp, {
  valid: [
    jsx('<Button route="a/b" />'),
    jsx('<Button route="a/[id]" params={{ id }} />'),
    jsx("<Button customId={buildId()} />"),
    jsx("<Button customId={`a/${id}`} />"),
    jsx("<Button onClick={handler} />"),
    jsx('<TextInput customId="field" />'),
    jsx('<Label label="x"><StringSelect customId="field" /></Label>'),
    jsx('<Modal><Label label="x"><UserSelect customId="field" /></Label></Modal>'),
    { filename, code: `${imports}defineModal("a", { render() { return <UserSelect customId="x" />; } });` },
    { filename, code: 'import { Button } from "./mine"; const node = <Button customId="x" />;' },
    { filename, code: 'const node = <Button customId="x" />;' },
  ],
  invalid: [
    { ...jsx('<Button customId="moderation/ban" />'), errors: [{ messageId: "preferRoute", data: { component: "Button" } }] },
    { ...jsx('<Button customId={"moderation/ban"} />'), errors: [{ messageId: "preferRoute" }] },
    { ...jsx("<Button customId={`moderation/ban`} />"), errors: [{ messageId: "preferRoute" }] },
    { ...jsx('<StringSelect customId="pick" />'), errors: [{ messageId: "preferRoute", data: { component: "StringSelect" } }] },
    { ...jsx('<ActionRow><RoleSelect customId="pick" /></ActionRow>'), errors: [{ messageId: "preferRoute" }] },
    {
      filename,
      code: 'import { Button as B } from "@neocord/react"; const node = <B customId="x" />;',
      errors: [{ messageId: "preferRoute", data: { component: "Button" } }],
    },
  ],
});

tester.run("no-text-in-action-row", noTextInActionRow, {
  valid: [
    jsx("<ActionRow><Button>Label</Button></ActionRow>"),
    jsx("<ActionRow>\n  <Button />\n</ActionRow>"),
    jsx('<ActionRow>{" "}<Button /></ActionRow>'),
    jsx("<ActionRow>{label}</ActionRow>"),
    jsx("<MediaGallery><MediaItem /></MediaGallery>"),
    jsx("<StringSelect><Option>Text</Option></StringSelect>"),
    jsx("<Message>Text</Message>"),
    { filename, code: "const node = <ActionRow>Text</ActionRow>;" },
  ],
  invalid: [
    { ...jsx("<ActionRow>Click</ActionRow>"), errors: [{ messageId: "text", data: { component: "ActionRow" } }] },
    { ...jsx('<ActionRow>{"Click"}</ActionRow>'), errors: [{ messageId: "text" }] },
    { ...jsx("<ActionRow>{5}</ActionRow>"), errors: [{ messageId: "text" }] },
    { ...jsx("<ActionRow><>Click</></ActionRow>"), errors: [{ messageId: "text" }] },
    { ...jsx("<MediaGallery>Photo</MediaGallery>"), errors: [{ messageId: "text", data: { component: "MediaGallery" } }] },
    { ...jsx("<StringSelect>Pick</StringSelect>"), errors: [{ messageId: "text", data: { component: "StringSelect" } }] },
    { ...jsx("<UserSelect>Pick</UserSelect>"), errors: [{ messageId: "text", data: { component: "UserSelect" } }] },
  ],
});
