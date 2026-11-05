import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import AboutCode from "../../content/landing/about.mdx";
import BanCode from "../../content/landing/ban.mdx";
import PingCode from "../../content/landing/ping.mdx";
import RefreshCode from "../../content/landing/refresh.mdx";
import {
  DiscordButton,
  DiscordContainer,
  DiscordField,
  DiscordFile,
  DiscordHeading,
  DiscordLiveCounter,
  DiscordMedia,
  DiscordModal,
  DiscordPreview,
  DiscordRow,
  DiscordSection,
  DiscordSelect,
  DiscordSubtext,
  DiscordText,
  DiscordThinking,
  DiscordThumbnail,
} from "../discord/DiscordPreview.tsx";
import { SlashMark } from "../Logo.tsx";
import { mdxComponents } from "../mdx-components.tsx";

function AboutMessage({ servers, latency, command }: { servers: number; latency: number; command?: string }) {
  return (
    <DiscordPreview {...(command ? { command } : {})} label="The about message in Discord">
      <DiscordContainer accent="blurple">
        <DiscordHeading>About my-bot</DiscordHeading>
        <DiscordText>
          <strong>Servers:</strong> {servers}
        </DiscordText>
        <DiscordText>
          <strong>Latency:</strong> {latency} ms
        </DiscordText>
        <DiscordRow>
          <DiscordButton>Refresh</DiscordButton>
        </DiscordRow>
      </DiscordContainer>
    </DiscordPreview>
  );
}

interface Example {
  id: string;
  route: string;
  file: string;
  note: string;
  code: ReactNode;
  result: ReactNode;
}

const EXAMPLES: readonly Example[] = [
  {
    id: "ping",
    route: "/ping",
    file: "command.tsx",
    note: "A folder under commands is a slash command. The returned JSX is the reply.",
    code: <PingCode components={mdxComponents} />,
    result: (
      <DiscordPreview command="/ping" label="The ping reply in Discord">
        <DiscordText>Pong! Gateway latency is 42 ms.</DiscordText>
      </DiscordPreview>
    ),
  },
  {
    id: "about",
    route: "/about",
    file: "command.tsx",
    note: "Components V2 layout, with a button addressed by a route that the compiler checks.",
    code: <AboutCode components={mdxComponents} />,
    result: <AboutMessage command="/about" servers={3} latency={42} />,
  },
  {
    id: "refresh",
    route: "general/refresh",
    file: "button.tsx",
    note: "A click runs this file. The node it returns updates the same message.",
    code: <RefreshCode components={mdxComponents} />,
    result: <AboutMessage servers={3} latency={38} />,
  },
];

function TreeRow({ indent, muted = false, children }: { indent: number; muted?: boolean; children: ReactNode }) {
  return (
    <span className={cn("block py-0.5 leading-snug whitespace-nowrap", muted && "text-muted-foreground")} style={{ paddingLeft: `${indent}rem` }}>
      {children}
    </span>
  );
}

function FileTab({ example, indent }: { example: Example; indent: number }) {
  return (
    <TabsTrigger
      value={example.id}
      style={{ paddingLeft: `${indent}rem` }}
      className="h-auto w-full flex-none justify-between gap-3 rounded-md py-0.5 pr-2 font-mono text-[0.82rem] leading-snug font-semibold text-foreground transition-colors after:hidden hover:bg-accent/60 data-active:bg-accent data-active:shadow-[inset_3px_0_0_var(--slash)]! dark:text-foreground dark:data-active:border-transparent dark:data-active:bg-accent"
    >
      {example.file}
      <span className="font-bold text-slash">{example.route}</span>
    </TabsTrigger>
  );
}

function HeroDemo() {
  const [ping, about, refresh] = EXAMPLES;
  if (ping === undefined || about === undefined || refresh === undefined) return null;

  return (
    <Tabs
      defaultValue="about"
      orientation="vertical"
      className="relative z-10 mx-auto -mt-20 grid max-w-[88rem] gap-0 overflow-hidden rounded-2xl border bg-card shadow-[0_30px_70px_-30px_rgb(32_30_110/0.55)] lg:grid-cols-[19.5rem_minmax(0,1fr)]"
    >
      <div className="border-b bg-muted/40 p-4 font-mono text-[0.82rem] lg:border-r lg:border-b-0">
        <TabsList aria-label="Files in a new neocord project" className="h-auto! w-full flex-col items-stretch justify-start rounded-none bg-transparent p-0 text-foreground">
          <TreeRow indent={0} muted>
            neocord.config.ts
          </TreeRow>
          <TreeRow indent={0.5}>src/</TreeRow>
          <TreeRow indent={1} muted>
            env.ts
          </TreeRow>
          <TreeRow indent={1} muted>
            error.tsx
          </TreeRow>
          <TreeRow indent={1}>features/general/</TreeRow>
          <TreeRow indent={1.5}>commands/ping/</TreeRow>
          <FileTab example={ping} indent={2} />
          <TreeRow indent={1.5}>commands/about/</TreeRow>
          <FileTab example={about} indent={2} />
          <TreeRow indent={1.5}>buttons/refresh/</TreeRow>
          <FileTab example={refresh} indent={2} />
        </TabsList>
      </div>
      {EXAMPLES.map((example) => (
        <TabsContent
          key={example.id}
          value={example.id}
          forceMount
          className="example-panel grid min-w-0 text-base data-[state=inactive]:hidden xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
        >
          <div data-slot="code-pane" className="tab-fade min-w-0 bg-code [&_pre]:max-h-[34rem]">
            {example.code}
          </div>
          <div className="flex min-w-0 flex-col gap-3.5 border-t p-4 xl:border-t-0 xl:border-l xl:p-5">
            {example.result}
            <p className="max-w-[30rem] text-[0.92rem] text-muted-foreground">{example.note}</p>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function ChannelBar() {
  return (
    <p className="flex flex-none items-center gap-1.5 border-b border-dc-line px-4 py-2.5 text-[0.92rem] font-semibold text-dc-bright">
      <span aria-hidden="true" className="text-dc-muted">
        #
      </span>
      general
    </p>
  );
}

function HeroConversation() {
  return (
    <div
      className="hero-rise relative overflow-hidden rounded-2xl bg-dc shadow-[0_40px_80px_-30px_rgb(16_14_70/0.8)] ring-1 ring-white/15"
      style={{ "--delay": "420ms" } as CSSProperties}
    >
      <ChannelBar />
      <div className="flex min-h-[8.5rem] items-end px-1 pt-3">
        <DiscordPreview command="/ping" label="The ping reply in Discord" className="hero-reply w-full max-w-none pb-2">
          <DiscordText>Pong! Gateway latency is 42 ms.</DiscordText>
        </DiscordPreview>
      </div>
      <div aria-hidden="true" className="relative mx-3.5 mb-3.5 flex h-11 items-center rounded-lg bg-[#383a40] px-3.5 font-mono text-[0.92rem] text-dc-text">
        <span className="hero-composer-typed absolute inset-y-0 left-3.5 hidden items-center motion-safe:flex">
          <span className="hero-typed inline-block overflow-hidden whitespace-nowrap">/ping</span>
          <span className="hero-caret ml-px inline-block h-[1.1em] w-0.5 bg-dc-bright" />
        </span>
        <span className="hero-composer-empty font-sans text-dc-muted">Message #general</span>
      </div>
    </div>
  );
}

function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? `Copied ${command} to clipboard` : `Copy ${command}`}
      className={cn(
        "sweep inline-flex h-11 items-center gap-2.5 rounded-lg border border-dashed border-current/40 px-3.5 text-[0.92rem] transition-colors hover:border-current/80",
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      <code>{command}</code>
      {copied ? <CheckIcon className="copied-pop js-only size-4" /> : <CopyIcon className="js-only size-4 opacity-70" />}
    </button>
  );
}

const CONVENTIONS: readonly (readonly [string, string])[] = [
  ["commands/ban/command.tsx", "/ban"],
  ["commands/mod/warn/command.tsx", "/mod warn"],
  ["commands/mod/case/view/command.tsx", "/mod case view"],
  ["user-commands/report/command.tsx", "User context menu command"],
  ["message-commands/quote/command.tsx", "Message context menu command"],
  ["buttons/confirm-ban/[userId]/button.tsx", "Button with custom id moderation/confirm-ban/<userId>"],
  ["selects/pick-role/select.tsx", "Select with custom id moderation/pick-role"],
  ["modals/ban-reason/[userId]/modal.tsx", "Modal with custom id moderation/ban-reason/<userId>"],
  ["events/guildMemberAdd.ts", "Listener for the guildMemberAdd client event"],
  ["tasks/cleanup.ts", "Task that runs on an interval"],
  ["_lib/anything.ts", "Private. Never becomes a route"],
];

const INCLUDED: readonly { title: string; to: string; text: string }[] = [
  {
    title: "Type-checked routes",
    to: "/docs/type-safety",
    text: "The CLI generates types from your files, so a typo in a button's route is a compile error and params are required exactly when a route has them.",
  },
  {
    title: "Replies that do not race",
    to: "/docs/handlers/replying",
    text: "One state machine owns every interaction. Slow handlers are deferred before Discord's three second limit, and reply, edit and follow-up choose themselves.",
  },
  {
    title: "Stateful messages",
    to: "/docs/ui/live-sessions",
    text: "Put onClick on a button and useState works, with an idle timeout that disables the components when the session ends.",
  },
  {
    title: "Sharding on Bun and Node",
    to: "/docs/sharding",
    text: "neocord start launches the sharding manager, in process or worker mode, and a bad token stops respawning instead of looping against Discord.",
  },
  {
    title: "Tests without a gateway",
    to: "/docs/testing",
    text: "neocord/testing runs the real dispatch pipeline on fake interactions, and neocord test validates every route and command payload first.",
  },
  {
    title: "Lint rules for the conventions",
    to: "/docs/eslint",
    text: "24 ESLint rules check file contracts, component nesting and Discord limits, with autofixes for route ids.",
  },
];

function GalleryWindow({ modal = false, children }: { modal?: boolean; children: ReactNode }) {
  return (
    <div data-gallery-window="" className="relative flex h-[19rem] flex-none flex-col overflow-hidden bg-dc">
      <ChannelBar />
      {modal ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-4 [&_figure]:w-full [&_figure]:shadow-xl">{children}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-end [&_figure]:max-w-none [&_figure]:rounded-none [&_figure]:bg-transparent">{children}</div>
      )}
    </div>
  );
}

const GALLERY: readonly { title: string; to: string; text: string; modal?: boolean; preview: ReactNode }[] = [
  {
    title: "Live state",
    to: "/docs/ui/live-sessions",
    text: "Put onClick on a button and useState keeps working between clicks. These two buttons run the same logic.",
    preview: <DiscordLiveCounter />,
  },
  {
    title: "Modals",
    to: "/docs/routing/modals",
    text: "A modal.tsx file holds the form and its submit handler, with a schema for the values.",
    modal: true,
    preview: (
      <DiscordModal title="Ban reason">
        <DiscordField label="Reason" description="Shown in the audit log" />
      </DiscordModal>
    ),
  },
  {
    title: "Selects",
    to: "/docs/routing/selects",
    text: "Send a select with a route, and a select.tsx file handles what the user picked.",
    preview: (
      <DiscordPreview command="/theme" ephemeral label="A theme select in Discord">
        <DiscordText>Pick a theme.</DiscordText>
        <DiscordRow>
          <DiscordSelect placeholder="Theme" />
        </DiscordRow>
      </DiscordPreview>
    ),
  },
  {
    title: "Attachments",
    to: "/docs/ui/attachments",
    text: "Pass a Buffer to File or MediaItem, and neocord attaches the bytes to the message for you.",
    preview: (
      <DiscordPreview command="/export" label="An export with a chart and a file in Discord">
        <DiscordContainer>
          <DiscordHeading level={2}>Your export</DiscordHeading>
          <DiscordMedia description="Activity chart" className="h-14 pt-2" />
          <DiscordFile name="report.csv" size="2.4 KB" />
        </DiscordContainer>
      </DiscordPreview>
    ),
  },
  {
    title: "Slow handlers",
    to: "/docs/handlers/replying",
    text: "Handlers that near Discord's three second limit are deferred for you, and the reply fills this in.",
    preview: (
      <DiscordPreview command="/report" label="A deferred reply in Discord">
        <DiscordThinking />
      </DiscordPreview>
    ),
  },
  {
    title: "Error views",
    to: "/docs/handlers/error-boundaries",
    text: "When a handler throws, the closest error.tsx decides what the user sees.",
    preview: (
      <DiscordPreview command="/ping" ephemeral label="An error view in Discord">
        <DiscordContainer accent="red">
          <DiscordHeading level={2}>Something went wrong</DiscordHeading>
          <DiscordSubtext>The error was logged. Please try again in a moment.</DiscordSubtext>
        </DiscordContainer>
      </DiscordPreview>
    ),
  },
];

const SECTION_HEADING = "type-display text-[clamp(1.7rem,3.6vw,2.6rem)]";
const LANDING_TEXT = "mt-3 max-w-[42rem] text-muted-foreground [&_code]:text-[0.9em] [&_code]:text-foreground";
const HERO_LINES = ["Your file tree", "is your", "Discord bot."];

export function Landing() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="relative isolate overflow-hidden bg-hero text-hero-foreground [--ring:#ffffff]">
        <div aria-hidden="true" className="hero-slash-drift absolute right-[8%] bottom-0 -z-10 h-[46%] lg:top-[-12%] lg:right-[14%] lg:bottom-auto lg:h-[135%]">
          <SlashMark className="hero-slash h-full w-auto text-hero-deep" />
        </div>
        <div aria-hidden="true" className="hero-slash-drift absolute right-[-14%] bottom-0 -z-10 h-[46%] lg:top-[-12%] lg:right-[3%] lg:bottom-auto lg:h-[135%]">
          <SlashMark className="hero-slash h-full w-auto text-[#eb459e]" />
        </div>
        <div className="mx-auto grid max-w-[88rem] items-center gap-10 px-4.5 pt-[clamp(2.5rem,6vw,5rem)] pb-32 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-14">
          <div>
            <h1 className="type-display text-[clamp(1.75rem,9.2vw,5.4rem)] leading-[1.02] lg:text-[clamp(3rem,5.7vw,5.4rem)]">
              {HERO_LINES.map((line, index) => (
                <span key={line} className="hero-line block w-fit whitespace-nowrap" style={{ "--line": index } as CSSProperties}>
                  {line}{" "}
                </span>
              ))}
            </h1>
            <p
              className="hero-rise mt-6 max-w-[40rem] text-[clamp(1.08rem,1.7vw,1.26rem)] leading-normal text-white/90 [&_code]:text-[0.9em] [&_code]:leading-[0] [&_code]:text-white"
              style={{ "--delay": "300ms" } as CSSProperties}
            >
              Put a file in <code>commands/ping</code> and you have <code>/ping</code>. Return JSX from the handler and neocord
              renders it as a Discord message. Built on discord.js and React, for Bun and Node.
            </p>
            <div className="hero-rise mt-7 flex flex-wrap items-center gap-2.5" style={{ "--delay": "380ms" } as CSSProperties}>
              <Button asChild className="sweep h-11 bg-sun px-5 text-base font-bold text-[#1a1836] hover:bg-sun">
                <Link to="/docs/quick-start" viewTransition>
                  Read the quick start
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="sweep h-11 border-white/40 bg-transparent px-5 text-base font-bold text-white hover:bg-transparent hover:text-white dark:border-white/40 dark:bg-transparent dark:hover:bg-transparent"
              >
                <Link to="/docs/manual-setup" viewTransition>
                  Set up by hand
                </Link>
              </Button>
              <CopyCommand command="bun create neocord" />
            </div>
          </div>
          <HeroConversation />
        </div>
      </section>

      <div className="px-4.5">
        <HeroDemo />
      </div>

      <div className="mx-auto max-w-[88rem] px-4.5">
        <section className="reveal py-16 sm:py-20" aria-labelledby="conventions-heading">
          <h2 id="conventions-heading" className={SECTION_HEADING}>
            The path decides what a file is
          </h2>
          <p className={LANDING_TEXT}>
            These paths sit in a feature folder such as <code>src/features/moderation</code>. There is no registry to update.
          </p>
          <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
            <Table label="File conventions" className="text-[0.92rem] leading-normal">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto bg-muted/70 px-4 py-2.5 font-bold">File</TableHead>
                  <TableHead className="h-auto bg-muted/70 px-4 py-2.5 font-bold">In Discord</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CONVENTIONS.map(([file, result]) => (
                  <TableRow key={file} className="group/row">
                    <TableCell className="px-4 py-2 align-top">
                      <code className="text-[0.85em] transition-colors group-hover/row:text-slash">{file}</code>
                    </TableCell>
                    <TableCell className="px-4 py-2 align-top whitespace-normal">{result}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-4">
            <Link to="/docs/project-structure" viewTransition className="font-semibold text-link underline decoration-link/35 underline-offset-4 transition-colors hover:decoration-slash">
              See every convention
            </Link>
          </p>
        </section>

        <section className="reveal border-t py-16 sm:py-20" aria-labelledby="jsx-heading">
          <h2 id="jsx-heading" className={SECTION_HEADING}>
            JSX in, Components V2 out
          </h2>
          <p className={LANDING_TEXT}>
            <code>@teamneo/neocord-react</code> is a real React renderer. Options infer their types, and Discord's limits are checked when
            the message renders, with errors that name the component.
          </p>
          <div className="mt-6 grid overflow-clip rounded-2xl border bg-card xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div data-slot="code-pane" className="min-w-0 bg-code">
              <BanCode components={mdxComponents} />
            </div>
            <div className="min-w-0 border-t bg-muted/40 p-4 xl:border-t-0 xl:border-l xl:p-5">
              <DiscordPreview
                command="/ban"
                ephemeral
                label="The ban confirmation in Discord"
                className="xl:sticky xl:top-[calc(var(--header-height)+1.25rem)]"
              >
                <DiscordContainer accent="red">
                  <DiscordSection accessory={<DiscordThumbnail label="A" />}>
                    <DiscordHeading level={2}>Ban ada?</DiscordHeading>
                    <DiscordSubtext>Posting spam in #general</DiscordSubtext>
                  </DiscordSection>
                  <DiscordRow>
                    <DiscordButton variant="danger">Ban</DiscordButton>
                  </DiscordRow>
                </DiscordContainer>
              </DiscordPreview>
            </div>
          </div>
        </section>

        <section className="reveal border-t py-16 sm:py-20" aria-labelledby="gallery-heading">
          <h2 id="gallery-heading" className={SECTION_HEADING}>
            Messages your bot can send
          </h2>
          <p className={LANDING_TEXT}>Each preview is drawn to match Discord, and links to the page that explains how to build it.</p>
          <ul className="mt-6 grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
            {GALLERY.map((item) => (
              <li key={item.to} className="flex min-w-0">
                <Card className="w-full gap-0 rounded-2xl py-0 text-base [--card-spacing:--spacing(6)]">
                  <GalleryWindow modal={item.modal ?? false}>{item.preview}</GalleryWindow>
                  <CardHeader className="flex-1 content-start gap-1.5 py-(--card-spacing)">
                    <CardTitle className="font-sans text-[1.05rem] font-bold">
                      <Link to={item.to} viewTransition className="text-inherit underline decoration-slash/40 underline-offset-4 transition-colors hover:decoration-slash">
                        {item.title}
                      </Link>
                    </CardTitle>
                    <CardDescription className="text-[0.95rem] leading-relaxed text-pretty">{item.text}</CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section className="reveal border-t py-16 sm:py-20" aria-labelledby="included-heading">
          <h2 id="included-heading" className={SECTION_HEADING}>
            What else you get
          </h2>
          <ul className="mt-6 grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
            {INCLUDED.map((item) => (
              <li key={item.to} className="flex min-w-0">
                <Link to={item.to} viewTransition className="group/item flex w-full rounded-2xl text-inherit no-underline">
                  <Card className="sweep w-full rounded-2xl text-base shadow-none transition-[box-shadow] [--card-spacing:--spacing(7)] [--sweep:var(--slash)] group-hover/item:ring-slash/60">
                    <CardHeader className="content-start gap-2.5">
                      <CardTitle className="flex items-baseline gap-2 font-sans text-[1.08rem] font-bold">
                        <span aria-hidden="true" className="font-mono text-slash">
                          /
                        </span>
                        <span>{item.title}</span>
                      </CardTitle>
                      <CardDescription className="text-[0.97rem] leading-relaxed text-pretty">{item.text}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section
        aria-labelledby="start-heading"
        className="mt-6 bg-hero pt-24 pb-10 text-hero-foreground [--ring:#ffffff] [clip-path:polygon(0_3.5rem,100%_0,100%_100%,0_100%)]"
      >
        <div className="mx-auto max-w-[88rem] px-4.5">
          <h2 id="start-heading" className="type-display text-[clamp(2.2rem,5.5vw,4rem)]">
            Start a bot
          </h2>
          <p className="mt-3 max-w-[42rem] text-white/90">Answer a few prompts, set a token, and run it. You need Bun, or Node 22.22 or later.</p>
          <p className="mt-6 flex flex-wrap items-center gap-2.5">
            <CopyCommand command="bun create neocord" />
            <Button asChild className="sweep h-11 bg-sun px-5 text-base font-bold text-[#1a1836] hover:bg-sun">
              <Link to="/docs/quick-start" viewTransition>
                Read the quick start
              </Link>
            </Button>
          </p>
          <footer className="mt-16 flex flex-wrap justify-between gap-x-6 gap-y-3 border-t border-white/25 pt-6 text-[0.9rem] text-white/85">
            <p>neocord is MIT licensed.</p>
            <nav aria-label="Footer" className="flex flex-wrap gap-4 [&_a]:underline-offset-4 [&_a:hover]:underline">
              <Link to="/docs" viewTransition>
                Docs
              </Link>
              <Link to="/docs/cli" viewTransition>
                CLI
              </Link>
              <Link to="/docs/troubleshooting" viewTransition>
                Troubleshooting
              </Link>
              <a href="https://www.npmjs.com/package/neocord" rel="noreferrer">
                npm
              </a>
            </nav>
          </footer>
        </div>
      </section>
    </main>
  );
}
