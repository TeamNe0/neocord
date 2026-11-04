import { Container, File, Heading, MediaGallery, MediaItem, Section, Subtext, TextDisplay, Thumbnail, escapeMarkdown } from "@neocord/react";
import { defineCommand, option } from "neocord";
import { createGradientPng, type Rgb } from "../../_lib/png";

const THEMES: Record<"sunset" | "ocean" | "forest", { from: Rgb; to: Rgb; accent: `#${string}` }> = {
  sunset: { from: [255, 94, 77], to: [255, 200, 87], accent: "#ff5e4d" },
  ocean: { from: [0, 119, 182], to: [144, 224, 239], accent: "#0077b6" },
  forest: { from: [27, 94, 32], to: [165, 214, 167], accent: "#1b5e20" },
};

export default defineCommand({
  description: "Draw a profile card with generated images",
  options: {
    theme: option.string({
      description: "Colours for the card",
      choices: [
        { name: "Sunset", value: "sunset" },
        { name: "Ocean", value: "ocean" },
        { name: "Forest", value: "forest" },
      ],
    }),
  },
  async execute(ctx) {
    const themeName = ctx.options.theme ?? "ocean";
    const { from, to, accent } = THEMES[themeName];
    const [swatch, banner] = await Promise.all([
      createGradientPng(64, 64, from, to),
      createGradientPng(480, 120, from, to),
    ]);
    const name = escapeMarkdown(ctx.user.displayName);
    const receipt = Buffer.from(`Card for ${ctx.user.username}\nTheme: ${themeName}\n`);

    return (
      <Container accentColor={accent}>
        <Section accessory={<Thumbnail src={swatch} name="swatch.png" description={`${themeName} swatch`} />}>
          <Heading level={3}>{name}</Heading>
          <TextDisplay>Theme: {themeName}</TextDisplay>
        </Section>
        <MediaGallery>
          <MediaItem src={banner} name="banner.png" description={`${themeName} banner`} />
        </MediaGallery>
        <File src={receipt} name="card.txt" />
        <Subtext>All three attachments are Buffers made in this handler.</Subtext>
      </Container>
    );
  },
});
