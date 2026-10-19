import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/layout/store-shell";
import { mergeSection, SITE_DEFAULTS, type LegalSection } from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/privacidad")({ component: Page });

function Page() {
  const br = useBr();
  const legal = mergeSection(
    SITE_DEFAULTS["legal.privacidad"],
    br.content["legal.privacidad"] as LegalSection,
  );
  const paras = legal.paragraphs.length
    ? legal.paragraphs
    : SITE_DEFAULTS["legal.privacidad"].paragraphs;

  return (
    <StoreShell>
      <article className="mx-auto max-w-2xl px-4 py-14">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-paper">{legal.title}</h1>
        {paras.map((p, i) => (
          <p key={i} className="mt-4 text-mist">
            {p}
          </p>
        ))}
      </article>
    </StoreShell>
  );
}
