import { prisma } from "@/server/lib/prisma";
import { saveSearchProfile, resolveRuleProposal } from "@/server/modules/search-profile/actions";
import { triggerDistillation } from "@/server/modules/ml/actions";
import { TaskProgress } from "@/components/task-progress";

export const dynamic = "force-dynamic";

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </label>
  );
}

function ListField({ name, label, hint, defaultValue }: { name: string; label: string; hint: string; defaultValue: string[] }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <textarea
        name={name}
        defaultValue={defaultValue.join("\n")}
        rows={4}
        className="w-full resize-y rounded-lg border border-input bg-background p-2.5 text-sm outline-none"
        placeholder="uma linha por item"
      />
    </div>
  );
}

export default async function ProfilePage() {
  const profile = await prisma.searchProfile.findFirstOrThrow({ where: { isActive: true }, orderBy: { version: "desc" } });
  const proposals = await prisma.profileRuleProposal.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Parâmetros de busca</span>
        <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          v{profile.version} · ativa
        </span>
        <div className="flex-1" />
        <TaskProgress types={["distill-rules"]} label="Analisando decisões recentes" />
        <form action={triggerDistillation}>
          <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
            Gerar sugestões de regra agora
          </button>
        </form>
      </div>

      <form action={saveSearchProfile} className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
        {proposals.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">Regras propostas pelo modelo</div>
            {proposals.map((p) => (
              <div key={p.id} className="rounded-xl border border-dashed border-yellow-500/40 bg-yellow-500/5 p-3.5">
                <p className="text-sm">{p.proposedRule}</p>
                <p className="mt-1 text-xs text-muted-foreground">{p.rationale}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    formAction={resolveRuleProposal.bind(null, p.id, true)}
                    className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
                  >
                    Adicionar ao perfil
                  </button>
                  <button
                    type="button"
                    formAction={resolveRuleProposal.bind(null, p.id, false)}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="text-base font-semibold">Obrigatório</div>
          <p className="text-xs text-muted-foreground">
            Vaga que não atende é descartada antes de qualquer LLM.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Toggle name="requireRemote" label="Só 100% remoto" hint="híbrido e presencial fora" defaultChecked={profile.requireRemote} />
          <Toggle name="requirePaysUsd" label="Remuneração em USD" hint="EUR e BRL fora" defaultChecked={profile.requirePaysUsd} />
          <Toggle name="requireHiresBrazil" label="Contrata no Brasil" hint="PJ global ou EOR" defaultChecked={profile.requireHiresBrazil} />
          <Toggle name="excludePeopleMgmt" label="Sem people management" hint="Manager, Head of, TLM" defaultChecked={profile.excludePeopleMgmt} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">Piso salarial anual (USD)</label>
            <input
              type="number"
              name="salaryFloorUsdAnnual"
              defaultValue={profile.salaryFloorUsdAnnual}
              className="mt-1.5 w-full rounded-lg border border-input bg-background p-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Alvo (USD)</label>
            <input
              type="number"
              name="salaryTargetUsdAnnual"
              defaultValue={profile.salaryTargetUsdAnnual}
              className="mt-1.5 w-full rounded-lg border border-input bg-background p-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Cap diário de vagas novas</label>
            <input
              type="number"
              name="maxJobsPerDay"
              defaultValue={profile.maxJobsPerDay}
              className="mt-1.5 w-full rounded-lg border border-input bg-background p-2 text-sm outline-none"
            />
          </div>
        </div>

        <div className="h-px bg-border" />

        <ListField name="targetTitles" label="Cargos-alvo" hint="um por linha" defaultValue={profile.targetTitles} />
        <ListField name="coreStack" label="Stack principal" hint="um por linha" defaultValue={profile.coreStack} />
        <ListField name="desiredStack" label="Stack desejada" hint="ganha bônus no score" defaultValue={profile.desiredStack} />
        <ListField name="avoidStack" label="Stack a evitar" hint="penaliza forte" defaultValue={profile.avoidStack} />

        <div className="h-px bg-border" />

        <div>
          <div className="text-base font-semibold">Constrói vs opera</div>
          <p className="text-xs text-muted-foreground">A régua que mais decide — vai literal pro prompt.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ListField name="wantToDo" label="Quero fazer" hint="" defaultValue={profile.wantToDo} />
          <ListField name="doNotWant" label="Não quero" hint="" defaultValue={profile.doNotWant} />
        </div>

        <ListField name="excludedCompanies" label="Empresas excluídas" hint="" defaultValue={profile.excludedCompanies} />

        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
          <input
            type="text"
            name="label"
            placeholder="Rótulo desta versão (opcional)"
            className="flex-1 rounded-lg border border-input bg-background p-2 text-sm outline-none"
          />
          <button type="submit" className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Salvar como v{profile.version + 1}
          </button>
        </div>
      </form>
    </div>
  );
}
