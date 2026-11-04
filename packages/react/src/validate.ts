import {
  ButtonStyle,
  ComponentType,
  TextInputStyle,
  type APIComponentInLabel,
  type APILabelComponent,
  type APIMessageComponent,
  type APISelectMenuComponent,
} from "discord.js";

export type RenderedComponent = APIMessageComponent | APIComponentInLabel | APILabelComponent;
export type RenderMode = "message" | "modal";

const COMPONENT_NAMES: Readonly<Record<RenderedComponent["type"], string>> = {
  [ComponentType.ActionRow]: "ActionRow",
  [ComponentType.Button]: "Button",
  [ComponentType.StringSelect]: "StringSelect",
  [ComponentType.TextInput]: "TextInput",
  [ComponentType.UserSelect]: "UserSelect",
  [ComponentType.RoleSelect]: "RoleSelect",
  [ComponentType.MentionableSelect]: "MentionableSelect",
  [ComponentType.ChannelSelect]: "ChannelSelect",
  [ComponentType.Section]: "Section",
  [ComponentType.TextDisplay]: "TextDisplay",
  [ComponentType.Thumbnail]: "Thumbnail",
  [ComponentType.MediaGallery]: "MediaGallery",
  [ComponentType.File]: "File",
  [ComponentType.Separator]: "Separator",
  [ComponentType.Container]: "Container",
  [ComponentType.Label]: "Label",
  [ComponentType.FileUpload]: "FileUpload",
  [ComponentType.RadioGroup]: "RadioGroup",
  [ComponentType.CheckboxGroup]: "CheckboxGroup",
  [ComponentType.Checkbox]: "Checkbox",
};

const MODAL_COMPONENTS: readonly ComponentType[] = [
  ComponentType.Label,
  ComponentType.TextDisplay,
  ComponentType.TextInput,
  ComponentType.StringSelect,
  ComponentType.UserSelect,
  ComponentType.RoleSelect,
  ComponentType.MentionableSelect,
  ComponentType.ChannelSelect,
  ComponentType.FileUpload,
  ComponentType.RadioGroup,
  ComponentType.CheckboxGroup,
  ComponentType.Checkbox,
];

export function componentName(component: RenderedComponent): string {
  return COMPONENT_NAMES[component.type];
}

export function assertString(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error(`${name} must be a string of ${min}-${max} characters.`);
  }
}

export function assertLength(
  value: readonly unknown[],
  name: string,
  min: number,
  max: number,
): void {
  if (value.length < min || value.length > max) {
    const range = min === max ? `exactly ${min}` : `${min}-${max}`;
    throw new Error(`${name} must contain ${range} ${max === 1 ? "item" : "items"}.`);
  }
}

function assertInteger(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function optionalString(value: unknown, name: string, max: number): void {
  if (value !== undefined) assertString(value, name, 0, max);
}

export function assertTypes<T extends RenderedComponent["type"]>(
  components: RenderedComponent[],
  allowed: readonly T[],
  parent: string,
): Extract<RenderedComponent, { type: T }>[] {
  for (const component of components) {
    if (!(allowed as readonly ComponentType[]).includes(component.type)) {
      throw new Error(`${componentName(component)} is not allowed inside ${parent}.`);
    }
  }
  return components as Extract<RenderedComponent, { type: T }>[];
}

function validateOptions(
  options: readonly { label: string; value: string; description?: string; default?: boolean }[],
  owner: string,
  min: number,
  max: number,
): void {
  assertLength(options, `${owner} options`, min, max);
  const values = new Set<string>();

  for (const option of options) {
    assertString(option.label, `${owner} option label`, 1, 100);
    assertString(option.value, `${owner} option value`, 1, 100);
    optionalString(option.description, `${owner} option description`, 100);
    if (values.has(option.value)) {
      throw new Error(`${owner} option values must be unique; "${option.value}" appears twice.`);
    }
    values.add(option.value);
  }
}

function validateRange(
  component: { min_values?: number; max_values?: number; required?: boolean },
  owner: string,
  limit: number,
  defaultMax: number,
  enforceRequired: boolean,
): void {
  const min = component.min_values ?? 1;
  const max = component.max_values ?? defaultMax;
  assertInteger(min, `${owner} minValues`, 0, limit);
  assertInteger(max, `${owner} maxValues`, 1, limit);
  if (min > max) throw new Error(`${owner} minValues cannot exceed maxValues.`);
  if (enforceRequired && component.required !== false && min === 0) {
    throw new Error(`${owner} minValues must be at least 1 when required is true.`);
  }
}

function validateSelect(component: APISelectMenuComponent, mode: RenderMode): void {
  const owner = componentName(component);
  optionalString(component.placeholder, `${owner} placeholder`, 150);
  validateRange(component, owner, 25, 1, mode === "modal");
  if (mode === "modal" && component.disabled !== undefined) {
    throw new Error(`${owner} in a modal cannot have a disabled prop.`);
  }

  if (component.type === ComponentType.StringSelect) {
    validateOptions(component.options, owner, 1, 25);
    if ((component.max_values ?? 1) > component.options.length) {
      throw new Error(`${owner} maxValues cannot exceed the number of options.`);
    }
    return;
  }

  if (component.default_values === undefined) return;

  assertLength(
    component.default_values,
    `${owner} defaultValues`,
    component.min_values ?? 1,
    component.max_values ?? 1,
  );
  const allowed: readonly string[] =
    component.type === ComponentType.UserSelect
      ? ["user"]
      : component.type === ComponentType.RoleSelect
        ? ["role"]
        : component.type === ComponentType.ChannelSelect
          ? ["channel"]
          : ["user", "role"];
  const defaults = new Set<string>();

  for (const value of component.default_values) {
    assertString(value.id, `${owner} default value id`, 1, 20);
    if (!allowed.includes(value.type)) {
      throw new Error(`${owner} default value type must be ${allowed.join(" or ")}.`);
    }
    const key = `${value.type}:${value.id}`;
    if (defaults.has(key)) throw new Error(`${owner} default values must be unique.`);
    defaults.add(key);
  }
}

export function validateComponent(component: RenderedComponent, mode: RenderMode): void {
  const name = componentName(component);

  if (component.id !== undefined) {
    assertInteger(component.id, `${name} id`, 0, 0xffffffff);
  }

  if ("custom_id" in component) {
    assertString(component.custom_id, `${name} customId`, 1, 100);
  }

  if (mode === "modal" && !MODAL_COMPONENTS.includes(component.type)) {
    throw new Error(`${name} is not allowed in a modal.`);
  }

  switch (component.type) {
    case ComponentType.Button: {
      const fields = component as unknown as Record<string, unknown>;
      assertInteger(component.style, "Button style", ButtonStyle.Primary, ButtonStyle.Premium);
      const forbidden =
        component.style === ButtonStyle.Premium
          ? ["custom_id", "label", "url", "emoji"]
          : component.style === ButtonStyle.Link
            ? ["custom_id", "sku_id"]
            : ["url", "sku_id"];

      for (const field of forbidden) {
        if (fields[field] !== undefined) {
          throw new Error(`Button style does not allow ${field}.`);
        }
      }

      if (component.style === ButtonStyle.Link) {
        assertString(component.url, "Button url", 1, 512);
      } else if (component.style === ButtonStyle.Premium) {
        assertString(component.sku_id, "Button skuId", 1, 20);
      } else {
        assertString(component.custom_id, "Button customId", 1, 100);
      }

      if (component.style !== ButtonStyle.Premium) {
        optionalString(component.label, "Button label", 80);
        if (!component.label && !component.emoji?.id && !component.emoji?.name) {
          throw new Error("Button requires a label or emoji.");
        }
      }
      break;
    }
    case ComponentType.StringSelect:
    case ComponentType.UserSelect:
    case ComponentType.RoleSelect:
    case ComponentType.MentionableSelect:
    case ComponentType.ChannelSelect:
      validateSelect(component, mode);
      break;
    case ComponentType.TextInput: {
      assertInteger(component.style, "TextInput style", TextInputStyle.Short, TextInputStyle.Paragraph);
      optionalString(component.placeholder, "TextInput placeholder", 100);
      optionalString(component.value, "TextInput value", 4000);
      assertInteger(component.min_length ?? 0, "TextInput minLength", 0, 4000);
      assertInteger(component.max_length ?? 4000, "TextInput maxLength", 1, 4000);
      if ((component.min_length ?? 0) > (component.max_length ?? 4000)) {
        throw new Error("TextInput minLength cannot exceed maxLength.");
      }
      break;
    }
    case ComponentType.TextDisplay:
      assertString(component.content, "TextDisplay content", 1, 4000);
      break;
    case ComponentType.Thumbnail:
      assertString(component.media.url, "Thumbnail src", 1, 2048);
      if (component.description !== null) {
        optionalString(component.description, "Thumbnail description", 1024);
      }
      break;
    case ComponentType.MediaGallery:
      assertLength(component.items, "MediaGallery items", 1, 10);
      for (const item of component.items) {
        assertString(item.media.url, "MediaGallery item src", 1, 2048);
        if (item.description !== null) {
          optionalString(item.description, "MediaGallery item description", 1024);
        }
      }
      break;
    case ComponentType.File:
      assertString(component.file.url, "File src", 1, 2048);
      if (!component.file.url.startsWith("attachment://") || component.file.url.length === 13) {
        throw new Error("File src must be a Buffer or an attachment://<filename> reference.");
      }
      break;
    case ComponentType.Container:
      assertLength(component.components, "Container children", 1, 40);
      if (component.accent_color !== undefined && component.accent_color !== null) {
        assertInteger(component.accent_color, "Container accentColor", 0, 0xffffff);
      }
      break;
    case ComponentType.Label:
      assertString(component.label, "Label text", 1, 45);
      optionalString(component.description, "Label description", 100);
      break;
    case ComponentType.FileUpload:
      validateRange(component, "FileUpload", 10, 1, true);
      if (component.file_types !== undefined) {
        assertLength(component.file_types, "FileUpload fileTypes", 1, 10);
        for (const type of component.file_types) {
          if (!["image", "video", "audio"].includes(type) && !(type.startsWith(".") && type.length > 1)) {
            throw new Error("FileUpload fileTypes must be image, video, audio, or dot-prefixed extensions.");
          }
        }
      }
      break;
    case ComponentType.RadioGroup:
      validateOptions(component.options, "RadioGroup", 2, 10);
      if (component.options.filter((option) => option.default).length > 1) {
        throw new Error("RadioGroup can have only one default option.");
      }
      break;
    case ComponentType.CheckboxGroup:
      validateOptions(component.options, "CheckboxGroup", 1, 10);
      validateRange(component, "CheckboxGroup", component.options.length, component.options.length, true);
      break;
  }
}
