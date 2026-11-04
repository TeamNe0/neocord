import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import AboutCode from "../../content/landing/about.mdx";
import BanCode from "../../content/landing/ban.mdx";
import PingCode from "../../content/landing/ping.mdx";
import RefreshCode from "../../content/landing/refresh.mdx";
import {
  DiscordButton,
  DiscordContainer,
  DiscordHeading,
  DiscordPreview,
  DiscordRow,
  DiscordSection,
  DiscordSubtext,
  DiscordText,
  DiscordThumbnail,
} from "../discord/DiscordPreview.tsx";
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
  note: string;
  code: ReactNode;
  result: ReactNode;
}

const EXAMPLES: readonly Example[] = [
  {
    id: "ping",
    route: "/ping",
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
    note: "Components V2 layout, with a button addressed by a route that the compiler checks.",
    code: <AboutCode components={mdxComponents} />,
    result: <AboutMessage command="/about" servers={3} latency={42} />,
  },
  {
    id: "refresh",
    route: "general/refresh",
    note: "A click runs this file. The node it returns updates the same message.",
    code: <RefreshCode components={mdxComponents} />,
    result: <AboutMessage servers={3} latency={38} />,
  },
];

const TREE_FILES: Record<string, string> = {
  ping: "command.tsx",
  about: "command.tsx",
  refresh: "button.tsx",
};

function HeroDemo() {
  const [current, setCurrent] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);

  const focusTab = (index: number): void => {
    setCurrent(index);
    tabs.current?.querySelector<HTMLButtonElement>(`[data-example="${index}"]`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const count = EXAMPLES.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusTab((current + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusTab((current - 1 + count) % count);
    }
  };

  const tab = (index: number, indent: number): ReactNode => {
    const example = EXAMPLES[index];
    if (example === undefined) return null;
    return (
      <button
        type="button"
        role="tab"
        id={`example-tab-${example.id}`}
        data-example={index}
        aria-selected={current === index}
        aria-controls={`example-panel-${example.id}`}
        tabIndex={current === index ? 0 : -1}
        className="tree-row tree-file"
        style={{ paddingLeft: `${indent}rem` }}
        onClick={() => setCurrent(index)}
      >
        {TREE_FILES[example.id]}
        <span className="tree-route">{example.route}</span>
      </button>
    );
  };

  const folder = (name: string, indent: number): ReactNode => (
    <span className="tree-row" style={{ paddingLeft: `${indent}rem` }}>
      {name}/
    </span>
  );

  return (
    <div className="hero-demo">
      <div className="pane pane-tree">
        <div ref={tabs} role="tablist" aria-label="Files in a new neocord project" aria-orientation="vertical" className="tree" onKeyDown={onKeyDown}>
          <span className="tree-row tree-muted">neocord.config.ts</span>
          {folder("src", 0.5)}
          <span className="tree-row tree-muted" style={{ paddingLeft: "1rem" }}>
            env.ts
          </span>
          <span className="tree-row tree-muted" style={{ paddingLeft: "1rem" }}>
            error.tsx
          </span>
          {folder("features/general", 1)}
          {folder("commands/ping", 1.5)}
          {tab(0, 2)}
          {folder("commands/about", 1.5)}
          {tab(1, 2)}
          {folder("buttons/refresh", 1.5)}
          {tab(2, 2)}
        </div>
      </div>
      {EXAMPLES.map((example, index) => (
        <div
          key={example.id}
          role="tabpanel"
          id={`example-panel-${example.id}`}
          aria-labelledby={`example-tab-${example.id}`}
          hidden={current !== index}
          className="example-panel"
        >
          <div className="pane pane-code">{example.code}</div>
          <div className="pane pane-result">
            {example.result}
            <p className="pane-note">{example.note}</p>
          </div>
        </div>
      ))}
    </div>
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

export function Landing() {
  return (
    <main id="main" tabIndex={-1} className="landing">
      <section className="hero">
        <h1>Your file tree is your Discord bot.</h1>
        <p className="hero-lede">
          Put a file in <code>commands/ping</code> and you have <code>/ping</code>. Return JSX from the handler and neocord
          renders it as a Discord message. Built on discord.js and React, for Bun and Node.
        </p>
        <div className="hero-actions">
          <Link to="/docs/quick-start" className="button button-primary">
            Read the quick start
          </Link>
          <Link to="/docs/manual-setup" className="button">
            Set up by hand
          </Link>
          <code className="hero-command">bun create neocord</code>
        </div>
        <HeroDemo />
      </section>

      <section className="landing-section" aria-labelledby="conventions-heading">
        <h2 id="conventions-heading">The path decides what a file is</h2>
        <p className="landing-text">
          These paths sit in a feature folder such as <code>src/features/moderation</code>. There is no registry to update.
        </p>
        <div className="table-wrap" role="region" aria-label="File conventions" tabIndex={0}>
          <table className="convention-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">In Discord</th>
              </tr>
            </thead>
            <tbody>
              {CONVENTIONS.map(([file, result]) => (
                <tr key={file}>
                  <td>
                    <code>{file}</code>
                  </td>
                  <td>{result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="landing-text">
          <Link to="/docs/project-structure">See every convention</Link>
        </p>
      </section>

      <section className="landing-section" aria-labelledby="jsx-heading">
        <h2 id="jsx-heading">JSX in, Components V2 out</h2>
        <p className="landing-text">
          <code>@teamneo/neocord-react</code> is a real React renderer. Options infer their types, and Discord's limits are checked when
          the message renders, with errors that name the component.
        </p>
        <div className="jsx-compare">
          <div className="pane pane-code">
            <BanCode components={mdxComponents} />
          </div>
          <div className="pane pane-result">
            <DiscordPreview command="/ban" ephemeral label="The ban confirmation in Discord">
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

      <section className="landing-section" aria-labelledby="included-heading">
        <h2 id="included-heading">What else you get</h2>
        <ul className="included">
          {INCLUDED.map((item) => (
            <li key={item.to}>
              <Link to={item.to}>{item.title}</Link>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-final" aria-labelledby="start-heading">
        <h2 id="start-heading">Start a bot</h2>
        <p className="landing-text">Answer a few prompts, set a token, and run it. You need Bun, or Node 22.22 or later.</p>
        <p className="hero-actions">
          <code className="hero-command">bun create neocord</code>
          <Link to="/docs/quick-start" className="button button-primary">
            Read the quick start
          </Link>
        </p>
      </section>

      <footer className="site-footer">
        <p>neocord is MIT licensed.</p>
        <nav aria-label="Footer">
          <Link to="/docs">Docs</Link>
          <Link to="/docs/cli">CLI</Link>
          <Link to="/docs/troubleshooting">Troubleshooting</Link>
          <a href="https://www.npmjs.com/package/neocord" rel="noreferrer">
            npm
          </a>
        </nav>
      </footer>
    </main>
  );
}
