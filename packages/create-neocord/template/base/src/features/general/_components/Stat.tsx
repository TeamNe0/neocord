import { Bold, TextDisplay } from "@teamneo/neocord-react";

export interface StatProps {
  label: string;
  value: string | number;
}

export function Stat({ label, value }: StatProps) {
  return (
    <TextDisplay>
      <Bold>{label}:</Bold> {value}
    </TextDisplay>
  );
}
