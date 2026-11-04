import type { ReactElement } from "react";
import { HOST, hostElement } from "../host.ts";
import type {
  CheckboxGroupProps,
  CheckboxProps,
  FileUploadProps,
  LabelProps,
  ModalProps,
  RadioGroupProps,
  TextInputProps,
} from "../types.ts";

export function Modal(props: ModalProps): ReactElement {
  return hostElement(HOST.modal, props);
}

export function Label(props: LabelProps): ReactElement {
  return hostElement(HOST.label, props);
}

export function TextInput(props: TextInputProps): ReactElement {
  return hostElement(HOST.textInput, props);
}

export function FileUpload(props: FileUploadProps): ReactElement {
  return hostElement(HOST.fileUpload, props);
}

export function RadioGroup(props: RadioGroupProps): ReactElement {
  return hostElement(HOST.radioGroup, props);
}

export function CheckboxGroup(props: CheckboxGroupProps): ReactElement {
  return hostElement(HOST.checkboxGroup, props);
}

export function Checkbox(props: CheckboxProps): ReactElement {
  return hostElement(HOST.checkbox, props);
}
