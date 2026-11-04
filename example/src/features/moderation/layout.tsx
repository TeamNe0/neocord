import { Container } from "@neocord/react";
import type { LayoutProps } from "neocord";

export default function ModerationLayout({ children }: LayoutProps) {
  return <Container accentColor="#ed4245">{children}</Container>;
}
