import type {
  Attachment,
  ChannelType,
  GuildMember,
  LocalizationMap,
  Role,
  User,
} from "discord.js";
import type {
  AutocompleteHandler,
  ChannelOfType,
  MentionableValue,
  OptionChoice,
  OptionDefinition,
  OptionKind,
} from "./types.ts";

interface BaseOptionInput<R extends boolean> {
  description: string;
  required?: R;
  nameLocalizations?: LocalizationMap;
  descriptionLocalizations?: LocalizationMap;
}

interface StringBounds {
  minLength?: number;
  maxLength?: number;
}

interface NumberBounds {
  minValue?: number;
  maxValue?: number;
}

type ChoicesInput<C extends readonly OptionChoice[]> = { choices: C; autocomplete?: never };

type AutocompleteInput<V extends string | number> = {
  choices?: never;
  autocomplete?: AutocompleteHandler<V>;
};

function build<T, R extends boolean, K extends OptionKind>(kind: K, input: object): OptionDefinition<T, R, K> {
  return { __neocord: "option", kind, ...input } as OptionDefinition<T, R, K>;
}

function stringOption<const C extends readonly OptionChoice<string>[], const R extends boolean = false>(
  input: BaseOptionInput<R> & StringBounds & ChoicesInput<C>,
): OptionDefinition<C[number]["value"], R, "string">;
function stringOption<const R extends boolean = false>(
  input: BaseOptionInput<R> & StringBounds & AutocompleteInput<string>,
): OptionDefinition<string, R, "string">;
function stringOption(input: object): OptionDefinition {
  return build("string", input);
}

function integerOption<const C extends readonly OptionChoice<number>[], const R extends boolean = false>(
  input: BaseOptionInput<R> & NumberBounds & ChoicesInput<C>,
): OptionDefinition<C[number]["value"], R, "integer">;
function integerOption<const R extends boolean = false>(
  input: BaseOptionInput<R> & NumberBounds & AutocompleteInput<number>,
): OptionDefinition<number, R, "integer">;
function integerOption(input: object): OptionDefinition {
  return build("integer", input);
}

function numberOption<const C extends readonly OptionChoice<number>[], const R extends boolean = false>(
  input: BaseOptionInput<R> & NumberBounds & ChoicesInput<C>,
): OptionDefinition<C[number]["value"], R, "number">;
function numberOption<const R extends boolean = false>(
  input: BaseOptionInput<R> & NumberBounds & AutocompleteInput<number>,
): OptionDefinition<number, R, "number">;
function numberOption(input: object): OptionDefinition {
  return build("number", input);
}

function channelOption<const T extends ChannelType = ChannelType, const R extends boolean = false>(
  input: BaseOptionInput<R> & { channelTypes?: readonly T[] },
): OptionDefinition<ChannelOfType<T>, R, "channel"> {
  return build("channel", input);
}

export const option = {
  string: stringOption,
  integer: integerOption,
  number: numberOption,
  boolean: <const R extends boolean = false>(input: BaseOptionInput<R>): OptionDefinition<boolean, R, "boolean"> =>
    build("boolean", input),
  user: <const R extends boolean = false>(input: BaseOptionInput<R>): OptionDefinition<User, R, "user"> =>
    build("user", input),
  member: <const R extends boolean = false>(input: BaseOptionInput<R>): OptionDefinition<GuildMember, R, "member"> =>
    build("member", input),
  channel: channelOption,
  role: <const R extends boolean = false>(input: BaseOptionInput<R>): OptionDefinition<Role, R, "role"> =>
    build("role", input),
  mentionable: <const R extends boolean = false>(
    input: BaseOptionInput<R>,
  ): OptionDefinition<MentionableValue, R, "mentionable"> => build("mentionable", input),
  attachment: <const R extends boolean = false>(
    input: BaseOptionInput<R>,
  ): OptionDefinition<Attachment, R, "attachment"> => build("attachment", input),
};
