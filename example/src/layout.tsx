import { Subtext } from "@teamneo/neocord-react";
import { useContext, type LayoutProps } from "neocord";

export default function RootLayout({ children }: LayoutProps) {
  const ctx = useContext();
  return (
    <>
      {children}
      <Subtext>
        {ctx.feature} on shard {ctx.shards.id}
      </Subtext>
    </>
  );
}
