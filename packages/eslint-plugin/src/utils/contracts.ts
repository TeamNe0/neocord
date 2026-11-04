import { DEFINE_HELPERS, type FileClassification } from "@neocord/routing";

export function expectedHelper(classification: FileClassification): string | null {
  switch (classification.type) {
    case "route":
      return DEFINE_HELPERS[classification.kind];
    case "group":
      return DEFINE_HELPERS.group;
    case "feature":
      return DEFINE_HELPERS.feature;
    case "context":
      return DEFINE_HELPERS.context;
    case "segment":
      return classification.kind === "middleware" ? DEFINE_HELPERS.middleware : null;
    default:
      return null;
  }
}

export function contractLabel(classification: FileClassification): string | null {
  switch (classification.type) {
    case "route":
    case "segment":
      return classification.kind;
    case "group":
    case "feature":
    case "context":
      return classification.type;
    default:
      return null;
  }
}

export function isComponentSegment(classification: FileClassification): boolean {
  return classification.type === "segment" && classification.kind !== "middleware";
}
