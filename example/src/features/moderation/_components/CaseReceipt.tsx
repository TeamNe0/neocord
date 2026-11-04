import { Bold, Heading, TextDisplay, Timestamp, UserMention, escapeMarkdown } from "@neocord/react";
import type { ModerationCase } from "~/db/schema";

const TITLES: Record<ModerationCase["type"], string> = {
  warn: "Warning issued",
  ban: "Member banned",
  report: "Report received",
};

export function CaseReceipt({ record, warnings }: { record: ModerationCase; warnings?: number }) {
  return (
    <>
      <Heading level={3}>
        {TITLES[record.type]}, case #{record.id}
      </Heading>
      <TextDisplay>
        <UserMention id={record.userId} />: {escapeMarkdown(record.reason)}
      </TextDisplay>
      {record.expiresAt === null ? null : (
        <TextDisplay>
          Expires <Timestamp date={record.expiresAt} style="R" />.
        </TextDisplay>
      )}
      {warnings === undefined ? null : (
        <TextDisplay>
          Active warnings: <Bold>{warnings}</Bold>
        </TextDisplay>
      )}
    </>
  );
}
