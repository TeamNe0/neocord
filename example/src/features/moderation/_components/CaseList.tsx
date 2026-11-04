import {
  ActionRow,
  Bold,
  Heading,
  List,
  ListItem,
  Option,
  StringSelect,
  Subtext,
  TextDisplay,
  Timestamp,
  UserMention,
  escapeMarkdown,
} from "@teamneo/neocord-react";
import type { ModerationCase } from "~/db/schema";
import type { CaseFilter } from "../_lib/cases";

const FILTER_LABELS: Record<CaseFilter, string> = {
  all: "All cases",
  warn: "Warnings",
  ban: "Bans",
  report: "Reports",
};

export function CaseList({ records, filter }: { records: readonly ModerationCase[]; filter: CaseFilter }) {
  return (
    <>
      <Heading level={3}>{FILTER_LABELS[filter]}</Heading>
      {records.length === 0 ? (
        <Subtext>No cases match this filter.</Subtext>
      ) : (
        <TextDisplay>
          <List>
            {records.map((record) => (
              <ListItem key={record.id}>
                <Bold>#{record.id}</Bold> {record.type} <UserMention id={record.userId} />{" "}
                <Timestamp date={record.createdAt} style="R" />: {escapeMarkdown(record.reason)}
                {record.active ? "" : " (expired)"}
              </ListItem>
            ))}
          </List>
        </TextDisplay>
      )}
      <ActionRow>
        <StringSelect route="moderation/case-filter" placeholder="Filter cases">
          {Object.entries(FILTER_LABELS).map(([value, label]) => (
            <Option key={value} label={label} value={value} default={value === filter} />
          ))}
        </StringSelect>
      </ActionRow>
    </>
  );
}
