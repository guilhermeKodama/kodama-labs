"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { triggerTraining, activateAutoTriage, revertToShadowMode } from "@/server/modules/ml/actions";
import { TaskProgress } from "@/components/task-progress";
import { cn } from "@/lib/utils";

type Model = { precision: number; shadowMode: boolean } | null;

export function MlControls({ model, pendingDecisions }: { model: Model; pendingDecisions: number }) {
  const [isPending, startTransition] = useTransition();

  const eligible = !!model && model.precision >= 0.95;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <TaskProgress types={["train-model"]} label="Treinando modelo" />
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => triggerTraining())}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
      >
        Treinar agora {pendingDecisions > 0 && `(${pendingDecisions} decisões novas)`}
      </button>

      {model && model.shadowMode && (
        <button
          type="button"
          disabled={isPending || !eligible}
          title={eligible ? undefined : "Precisão precisa clarear 95% em validação cruzada primeiro"}
          onClick={() =>
            startTransition(async () => {
              const result = await activateAutoTriage();
              if (result.error) toast.error(result.error);
            })
          }
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40",
            eligible ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          )}
        >
          Ativar auto-triagem
        </button>
      )}

      {model && !model.shadowMode && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => revertToShadowMode())}
          className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs text-destructive disabled:opacity-50"
        >
          Voltar para modo sombra
        </button>
      )}
    </div>
  );
}
